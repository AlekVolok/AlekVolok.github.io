---
title: 'HLOD is not just a bigger LOD'
description: 'Unreal’s Hierarchical LOD collapses many actors into one proxy mesh, so a distant neighbourhood costs a single draw call — a different problem from the one mesh LODs solve.'
date: 2026-08-30
tags: [UnrealEngine, Runtime, Optimization, HLOD, WorldPartition, DrawCalls]
---

The two names look like a series — LOD, then hierarchical LOD — so they get treated as the same idea at two scales. They aren't. They target different bottlenecks, and reaching for the wrong one is how you end up with a scene that has plenty of GPU headroom and still misses frame time.

## What each one actually reduces

A mesh LOD is per-asset. One static mesh ships with several triangle budgets, and the renderer swaps between them based on screen size. Ten thousand triangles become five hundred at distance. What does *not* change is that the actor is still an actor: it still gets culled, still gets its transform updated, still issues its own draw call.

HLOD is spatial. It takes a *group* of actors — a block of buildings, a cluster of props — bakes them into a single proxy mesh with a merged material and an atlased texture, and draws that instead. Fifty actors become one.

So:

- **LODs cut triangles.** They help when the GPU is the bottleneck.
- **HLOD cuts draw calls and actor count.** It helps when the render thread is the bottleneck.

That distinction is the whole thing. If `stat unit` shows a render thread number sitting well above your game and GPU numbers, adding more aggressive mesh LODs will do almost nothing — you're not triangle-bound, you're bound by the sheer count of things being submitted. That's HLOD's problem to solve.

## Where it lives in UE5

Under World Partition, HLOD stopped being a separate outliner you drive by hand and became a property of the actors themselves.

Actors are assigned an **HLOD Layer**. Each layer decides how its actors get combined, and layers chain: the output of one layer can feed the next, giving you progressively coarser representations as distance grows. The build itself is a commandlet rather than an editor button:

```
UnrealEditor-Cmd.exe <Project>.uproject -run=WorldPartitionBuilderCommandlet ^
  -Builder=WorldPartitionHLODsBuilder -AllowCommandletRendering
```

Which is worth knowing, because it means HLOD is a build step. It goes stale. Move a building, and until someone rebuilds HLODs, the distant view still shows the old one.

### The four layer types

The layer type decides the tradeoff you're making:

- **Instancing** — keeps the source meshes, merges them into instanced static meshes. Cheapest to build, preserves detail, but every unique mesh still costs a draw call. Good for a first HLOD level.
- **Merged Mesh** — welds geometry into one mesh with a combined material. A real draw call collapse.
- **Simplified Mesh** — merges *and* decimates. What you want for mid distance.
- **Approximated Mesh** — throws a coarse shell over the whole cluster. Detail is gone; at that distance it was never resolvable anyway.

## The part people miss: streaming

The draw call win is the advertised benefit. The one that actually changes how you build a level is this: **HLOD is what remains visible after a streaming cell unloads.**

World Partition unloads cells outside the streaming range. Without HLOD, that's exactly what it sounds like — the world ends at your streaming distance. HLOD is the stand-in that keeps the horizon populated while the real actors, their collision, and their memory are gone.

This reframes the setting. HLOD isn't a polish-phase optimization you apply at the end; it's a prerequisite for having a streaming range small enough to fit your memory budget in the first place.

## Does Nanite make this obsolete?

Partly, and only for the half of the problem Nanite addresses.

Nanite is virtualized geometry: cluster detail scales with screen resolution, which removes most of the reason to author discrete LODs on opaque rigid meshes. Triangle count largely stops being the thing you manage by hand.

What Nanite does not remove is per-actor overhead. Fifty thousand Nanite actors are still fifty thousand actors to cull and track, and they still occupy memory while their cell is loaded. Both of those are HLOD's territory, not Nanite's.

The practical shape of it in a Nanite project:

- Mesh LODs — mostly unnecessary for Nanite-enabled opaque geometry. Still required for anything Nanite doesn't cover: skeletal meshes, translucency, foliage that needs it.
- HLOD — still needed, arguably more visibly, because Nanite makes it easy to place far more actors than you would have before.

## Measure before you build

The failure mode is building HLODs for a scene that was never draw-call bound, then wondering why the frame didn't move.

Start with `stat unit` to find which thread you're actually waiting on. If it's the render thread, `stat rhi` will show primitive and draw call counts. Unreal Insights will show you where the time goes with far more resolution than either. Only once the numbers say "too many things submitted" is HLOD the right answer — and then it's a very good one.
