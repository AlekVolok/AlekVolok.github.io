---
title: 'World Partition, tick to pixel'
description: 'Following one streaming cell all the way through the engine — from the tick that decides it should load, to the draw call that puts it on screen. Traced against UE 5.8 source.'
date: 2026-08-30
tags: [UnrealEngine, Runtime, WorldPartition, Rendering, Optimization]
---

"World Partition streams the level in" is where most explanations stop. That sentence hides about eight subsystems and two threads, and when something goes wrong — a cell that pops in late, a hitch on a level boundary, an actor that renders one frame after it should — you need to know which of those stages you're actually standing in.

So here's the whole path, one cell, tick to pixel. Function names and call sites are traced against **UE 5.8**; a few of them changed name in 5.x, and I'll flag those where they bite.

![World Partition pipeline: from the game-thread tick through source hashing, cell selection, level streaming, actor registration, scene proxies, render-thread visibility, and finally a pixel on the GPU.](/images/blog/world-partition-pipeline.svg)

The important boundary is near the end: the game thread decides that a cell should exist, but the render thread still decides whether its proxies are visible and worth drawing. The eight stages below unpack every box in that handoff.

## Stage 1 — The tick decides

![A game-frame timeline showing the World Partition streaming update after the PostPhysics tick group.](/images/blog/world-partition/stage-1-tick.svg)

Streaming is not a background service that runs whenever it likes. It's driven from inside `UWorld::Tick`, and its position in that function matters:

```
UWorld::Tick(ELevelTick, float)                      LevelTick.cpp:1502
├── RunTickGroup(TG_PrePhysics)                      LevelTick.cpp:1750
├── RunTickGroup(TG_StartPhysics / DuringPhysics)
├── RunTickGroup(TG_EndPhysics)
├── RunTickGroup(TG_PostPhysics)                     LevelTick.cpp:1778
│
└── InternalUpdateStreamingState()                   LevelTick.cpp:1865
```

Streaming is evaluated **after** the tick groups have run, and it's guarded:

```cpp
if (!bIsPaused && IsGameWorld())
{
    InternalUpdateStreamingState();
}
```

Two consequences fall straight out of that. Streaming state is computed against actor positions *after* this frame's movement — so a camera that teleports in `TG_PostPhysics` is already accounted for. And streaming does not advance while paused, which is exactly why a paused game sitting on a boundary never finishes loading the cell it's halfway into.

## Stage 2 — Into the World Partition subsystem

![UWorld dispatching a shared streaming interface to World Partition, Level Instances, and other subsystem implementations.](/images/blog/world-partition/stage-2-subsystem.svg)

`UWorld::InternalUpdateStreamingState` (World.cpp:4862) doesn't know what World Partition is. It walks subsystems that implement a streaming interface:

```cpp
SubsystemCollection.ForEachSubsystemWithInterface<UStreamingWorldSubsystemInterface>(
    [](UWorldSubsystem* WorldSubsystem)
    {
        CastChecked<IStreamingWorldSubsystemInterface>(WorldSubsystem)->OnUpdateStreamingState();
    });
```

This is the seam worth knowing about. World Partition is not privileged here — it's one `IStreamingWorldSubsystemInterface` implementer among several. `ULevelInstanceSubsystem` implements the same interface, and legacy World Composition is handled separately just above. If you're adding your own streaming-driven system, this is the interface to implement, and you inherit the same once-per-tick cadence for free.

From there:

```
UWorldPartitionSubsystem::OnUpdateStreamingState()          WorldPartitionSubsystem.cpp:1168
└── UWorldPartitionSubsystem::UpdateStreamingStateInternal() WorldPartitionSubsystem.cpp:1238
    └── UWorldPartitionStreamingPolicy::UpdateStreamingState() WorldPartitionStreamingPolicy.cpp:271
```

## Stage 3 — Sources, then a hash

![A camera streaming source over the runtime grid feeding a hash that either skips or triggers the spatial query.](/images/blog/world-partition/stage-3-sources.svg)

The policy's first job is to work out *where the interest is*. Streaming sources are the camera, the player, anything registered as a source provider:

```
UWorldPartitionStreamingPolicy::UpdateStreamingSources()    :105
└── WorldPartitionSubsystem->GetStreamingSources(...)       :128
```

Note what happens immediately before that call:

```cpp
const uint32 NewUpdateStreamingSourcesHash = WorldPartitionSubsystem->GetStreamingSourcesHash();
if (bCanOptimizeUpdate && (UpdateStreamingSourcesHash == NewUpdateStreamingSourcesHash))
{
    // ... velocity update only, early out
}
```

The sources are hashed, and if the hash is unchanged from last frame the expensive query is skipped entirely. A stationary camera costs almost nothing. This is also why "it hitches only when I move" is the normal shape of a streaming performance problem — the work is proportional to *change*, not to world size.

## Stage 4 — Sources become cells

![A runtime grid with activated, loaded, and unloaded cells selected around a streaming source.](/images/blog/world-partition/stage-4-cells.svg)

The runtime hash — the spatial structure your world is partitioned into — turns source positions into a set of cells and a target state for each:

```
InParams.RuntimeHash->ForEachStreamingCellsSources(
    InParams.CurrentState.StreamingSources,
    [](const UWorldPartitionRuntimeCell* Cell, EStreamingSourceTargetState SourceTargetState) { ... })
                                                            :424
```

Each cell gets a target state — loaded, or activated. The distinction matters and is the one people most often blur:

- **Loaded** — the package is in memory. Actors exist. Nothing is in the world.
- **Activated** — the level has been added to the world. Actors are registered, ticking, rendering.

The policy diffs target state against current state to produce work lists, `BuildCellsToUnload` (:642) handling the other direction, and hands them out through:

```
UWorldPartitionStreamingPolicy::GetCellsToUpdate(OutToLoadCells, OutToActivateCells)   :955
```

There is also `GetCellsToReprioritize` (:963) — cells already in flight whose urgency changed because you turned around. Streaming requests are not fire-and-forget; they're continuously re-ranked.

## Stage 5 — A cell is really a streaming level

![The streaming level state machine moving a cell from unloaded through asynchronous package I/O to loaded and activated.](/images/blog/world-partition/stage-5-level.svg)

Here World Partition hands off to machinery that predates it. Each runtime cell owns a `ULevelStreaming`:

```
UWorldPartitionRuntimeLevelStreamingCell::Load()             :727
UWorldPartitionRuntimeLevelStreamingCell::Activate()         :735
└── LocalLevelStreaming->Activate()                          :739
    → UWorldPartitionLevelStreamingDynamic::Activate()       :665
```

`UWorldPartitionLevelStreamingDynamic` derives from `ULevelStreaming`. Everything downstream of this point is the same code path a hand-placed sublevel takes — which is genuinely useful, because it means the older body of knowledge about `ULevelStreaming` still applies, and so do the same debugging commands.

The level streaming state machine then advances:

```
ULevelStreaming::UpdateStreamingState(bOutUpdateAgain, bOutRedetermineTarget, ...)  LevelStreaming.cpp:1023
└── ULevelStreaming::RequestLevel(PersistentWorld, bAllowLevelLoadRequests, BlockPolicy)  :1588
```

`RequestLevel` is where the async package load is kicked off, and where an already-resident package is found in memory instead. `BlockPolicy` is the parameter behind `BlockTillLevelStreamingCompleted` — the synchronous path that trades a hitch for a guarantee.

## Stage 6 — AddToWorld, the incremental one

![Actor and component registration split across three frame budgets by incremental AddToWorld processing.](/images/blog/world-partition/stage-6-add-to-world.svg)

The package is loaded. Actors exist in memory but are not in the world. `UWorld::AddToWorld` (World.cpp:3666) does that, and it is deliberately *incremental* — it is written to be spread across frames:

```
UWorld::AddToWorld(Level, LevelTransform, bConsiderTimeLimit, ...)
├── Level->IncrementalUpdateComponents(NumComponentsToUpdate, bRerunConstructionScript, &Context)
├── Level->RouteActorInitialize(NumActorsToProcess)
└── (sort actor list, initialize rendering resources)
```

`bConsiderTimeLimit` is the whole story of level-streaming hitches. When true, each stage checks `IsTimeLimitExceeded` and bails out to resume next frame; the level goes visible over several frames. When false — a blocking load — it runs to completion in one, and you get the hitch.

This is also why `s.LevelStreamingActorsUpdateTimeLimit` and friends exist: they're the budget those checks measure against. If your cells pop in visibly late, this stage is usually where the time went, not the package load.

## Stage 7 — Components become scene proxies

![A primitive component on the game thread enqueueing a command that creates a scene proxy on the render thread.](/images/blog/world-partition/stage-7-proxies.svg)

Registering a component is what actually connects an actor to the renderer:

```
UActorComponent::RegisterComponentWithWorld(InWorld, Context)     ActorComponent.cpp:1967
└── UActorComponent::CreateRenderState_Concurrent(Context)        ActorComponent.cpp:2243
    └── UPrimitiveComponent::CreateRenderState_Concurrent(Context) PrimitiveComponent.cpp:620
        └── GetWorld()->Scene->AddPrimitive(this)                  PrimitiveComponent.cpp:648
```

`FScene::AddPrimitive` (RendererScene.cpp:1341) is the thread boundary. It does not add anything directly — it creates the proxy and enqueues a command. The real work happens on the render thread:

```
FScene::AddPrimitiveSceneInfo_RenderThread(PrimitiveSceneInfo, PreviousTransform)  RendererScene.cpp:1069
```

There's a batched form too — `FScene::BatchAddPrimitives` (:1522) — which is what you want when a cell brings in thousands of primitives at once, since it amortises the command overhead across the whole batch.

**The one-frame latency lives here.** The game thread registered the component this frame; the render thread consumes the command when it gets there. An actor is never visible on the same frame its component registered.

## Stage 8 — Visibility, and a rename that trips people up

![Camera frustum and occlusion culling reducing scene proxies to draw commands that the GPU rasterizes into pixels.](/images/blog/world-partition/stage-8-visibility.svg)

The primitive is now in the scene. Being in the scene is not being drawn:

```
FDeferredShadingSceneRenderer::Render(GraphBuilder, SceneUpdateInputs)   DeferredShadingRenderer.cpp:1822
└── FDeferredShadingSceneRenderer::BeginInitViews(...)                   SceneVisibility.cpp:5918
    ├── frustum culling      (r.Visibility.FrustumCull.Enabled)
    ├── occlusion culling    FGPUOcclusionParallelPacket::OcclusionCullTask   :3372
    └── relevance → mesh draw commands
```

If you're carrying older knowledge: **`ComputeViewVisibility` is effectively gone in 5.8** — two textual references survive in the Renderer module, neither of them the entry point everyone used to breakpoint. The function to break on now is `BeginInitViews`. Occlusion culling has also been restructured into parallel packet tasks (`FGPUOcclusionPacket::OcclusionCullPrimitive`, `OcclusionCullTask`), so a single breakpoint no longer catches every primitive.

Frustum culling is now behind console variables worth knowing: `r.Visibility.FrustumCull.Enabled` and `r.Visibility.FrustumCull.NumPrimitivesPerTask` for task granularity.

## The whole chain

```
UWorld::Tick
└── InternalUpdateStreamingState                    ← after tick groups, skipped when paused
    └── IStreamingWorldSubsystemInterface::OnUpdateStreamingState
        └── UWorldPartitionSubsystem::UpdateStreamingStateInternal
            └── UWorldPartitionStreamingPolicy::UpdateStreamingState
                ├── UpdateStreamingSources             ← hashed, early-outs when still
                ├── RuntimeHash->ForEachStreamingCellsSources
                └── GetCellsToUpdate
                    └── UWorldPartitionRuntimeLevelStreamingCell::Activate
                        └── ULevelStreaming::UpdateStreamingState
                            └── RequestLevel           ← async package load
                                └── UWorld::AddToWorld ← incremental, time-limited
                                    └── IncrementalUpdateComponents
                                        └── RegisterComponentWithWorld
                                            └── CreateRenderState_Concurrent
                                                └── FScene::AddPrimitive
─── thread boundary ────────────────────────────────────────────────────
                                                    └── AddPrimitiveSceneInfo_RenderThread
                                                        └── BeginInitViews
                                                            └── cull → mesh draw commands → GPU
```

## Where to look when it goes wrong

Knowing the chain turns vague symptoms into a specific stage:

- **Cell never loads.** Stage 1–4. Is the world paused? Is there a registered streaming source? Is the cell in the runtime hash at all?
- **Loads but nothing appears.** Stage 4's loaded-vs-activated split. The package is resident; the level was never added to the world.
- **Appears late, several frames after it should.** Stage 6. `AddToWorld` is spending its per-frame budget. Raise the limits, or reduce component count per cell.
- **One big hitch instead of a smooth fade-in.** Something forced a blocking load — `bConsiderTimeLimit` false, or a `BlockTillLevelStreamingCompleted` upstream.
- **In the world, still not drawn.** Stage 8. Culled, or the render thread hasn't consumed the add command yet.

The general lesson is that "streaming is slow" is never actionable, because streaming isn't one thing — it's a package load, an incremental world merge, a component registration pass, and a render-thread handoff, and those four fail in completely different ways.

For Epic's higher-level view of grid cells, streaming sources, loading range, and runtime grid settings, see the official [World Partition documentation](https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine).
