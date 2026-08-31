/**
 * Knowledge graphs.
 *
 * Each graph is a tree: one root, branches below it. `group` drives the colour
 * coding in the rendered graph, `note` is what shows in the detail panel.
 */

export const graphs = [
  {
    slug: 'unreal-engine',
    title: 'Unreal Engine',
    summary:
      'How the engine splits in practice: the tools you author with, the systems that ship in the build, and the work of making those systems fit a frame budget.',
    tags: ['Unreal', 'Rendering', 'Pipeline', 'Optimization'],
    groups: [
      { id: 'editor', label: 'Editor' },
      { id: 'runtime', label: 'Runtime' },
      { id: 'optimization', label: 'Optimization' },
    ],
    root: {
      id: 'ue',
      label: 'Unreal Engine',
      aliases: ['UE', 'UE5', 'Unreal'],
      group: 'root',
      note: 'Epic’s real-time engine. The split below is the one that matters day to day: what runs at author time in the Editor, and what ships inside the Runtime frame loop.',
      children: [
        {
          id: 'editor',
          label: 'Editor',
          group: 'editor',
          note: 'Author-time tooling. None of this exists in a shipped build — it produces the assets and data that do.',
          children: [
            {
              id: 'blueprints',
              label: 'Blueprints',
              aliases: ['Blueprint', 'BP'],
              group: 'editor',
              note: 'Visual scripting for gameplay logic and editor utilities. Compiles to bytecode on a VM; hot paths usually get moved to C++.',
            },
            {
              id: 'material-editor',
              label: 'Material Editor',
              aliases: ['Materials', 'Shaders'],
              group: 'editor',
              note: 'Node graph for surface shading. Each material compiles to HLSL permutations per platform and feature level — permutation count is a real build-time cost.',
            },
            {
              id: 'niagara',
              label: 'Niagara',
              aliases: ['VFX', 'Particles'],
              group: 'editor',
              note: 'Particle and VFX system built from emitter/module graphs, running on CPU or GPU simulation.',
            },
            {
              id: 'sequencer',
              label: 'Sequencer',
              aliases: ['Cinematics'],
              group: 'editor',
              note: 'Non-linear editor for cinematics, camera work and scripted sequences.',
            },
            {
              id: 'pcg',
              label: 'PCG Framework',
              aliases: ['PCG'],
              group: 'editor',
              note: 'Procedural Content Generation graphs — scattering, filtering and world building driven by rules rather than hand placement.',
            },
            {
              id: 'editor-scripting',
              label: 'Editor Scripting',
              aliases: ['EditorUtilityWidgets', 'UnrealPython'],
              group: 'editor',
              note: 'Python and Editor Utility Widgets. Where most pipeline automation lives: batch imports, validation, asset fixups.',
            },
          ],
        },
        {
          id: 'runtime',
          label: 'Runtime',
          group: 'runtime',
          note: 'The shipped frame loop and the systems inside it. Everything here has a per-frame cost you can measure.',
          children: [
            {
              id: 'rendering',
              label: 'Rendering',
              aliases: ['Renderer', 'Lumen'],
              group: 'runtime',
              note: 'The renderer itself — deferred and forward paths, Nanite virtualized geometry, Lumen global illumination, shadow and post pipelines.',
            },
            {
              id: 'animation',
              label: 'Animation',
              aliases: ['Anim', 'ControlRig'],
              group: 'runtime',
              note: 'Anim Blueprints, state machines, blend spaces and Control Rig evaluated per frame on the game and worker threads.',
            },
            {
              id: 'physics',
              label: 'Physics (Chaos)',
              aliases: ['Chaos', 'Physics'],
              group: 'runtime',
              note: 'Chaos solver: rigid bodies, constraints, destruction and cloth.',
            },
            {
              id: 'gameplay',
              label: 'Gameplay Framework',
              aliases: ['Gameplay', 'Replication'],
              group: 'runtime',
              note: 'Actors, components, the tick loop, and replication for networked play.',
            },
            {
              id: 'world-partition',
              label: 'World Partition',
              aliases: ['DataLayers'],
              group: 'runtime',
              note: 'Grid-based streaming with Data Layers and Level Instances — how large open worlds stay inside a memory budget.',
            },
            {
              id: 'optimization',
              label: 'Optimization',
              aliases: ['Performance', 'Optimisation'],
              group: 'optimization',
              note: 'Making the frame fit the budget without visibly losing fidelity. Always measure first — the expensive thing is rarely the thing you assumed.',
              children: [
                {
                  id: 'insights',
                  label: 'Unreal Insights',
                  aliases: ['Insights', 'Profiling'],
                  group: 'optimization',
                  note: 'Trace capture and timeline analysis for CPU and GPU. The starting point: find which thread is actually the bottleneck before touching anything.',
                },
                {
                  id: 'draw-calls',
                  label: 'Draw Calls & Instancing',
                  aliases: ['DrawCalls', 'Instancing', 'ISM', 'HISM'],
                  group: 'optimization',
                  note: 'Batching, Instanced and Hierarchical Instanced Static Meshes, and cutting primitive count to unload the render thread.',
                },
                {
                    id: 'lods',
                    label: 'LODs',
                    aliases: ['LOD', 'StaticMeshLOD', 'MeshLOD'],
                    group: 'optimization',
                    note: 'Per-mesh detail reduction. One asset, several triangle budgets, swapped by screen size — it cuts triangles, not draw calls.',
                  },
                  {
                    id: 'hlod',
                    label: 'HLOD',
                    aliases: ['HLODs', 'HierarchicalLOD', 'ProxyMesh'],
                    group: 'optimization',
                    note: 'Hierarchical LOD. Many actors collapse into one proxy mesh with a merged material, so a whole distant neighbourhood costs a single draw call. Under World Partition it is also what stays visible once a cell unloads.',
                  },
                {
                  id: 'nanite',
                  label: 'Nanite',
                  aliases: ['VirtualizedGeometry'],
                  group: 'optimization',
                  note: 'Virtualized geometry — clusters stream and scale with screen resolution, removing most manual LOD authoring for opaque rigid meshes.',
                },
                {
                  id: 'texture-streaming',
                  label: 'Texture Streaming',
                  aliases: ['Textures', 'MipStreaming', 'TextureBudget'],
                  group: 'optimization',
                  note: 'Mip pool size, streaming distances and budgets. Usually the first place memory overruns show up.',
                },
                {
                  id: 'culling',
                  label: 'Culling',
                  aliases: ['Occlusion'],
                  group: 'optimization',
                  note: 'Frustum, distance and occlusion culling, plus precomputed visibility — not drawing something is always cheaper than drawing it well.',
                },
                {
                  id: 'shader-complexity',
                  label: 'Shader Complexity',
                  aliases: ['Overdraw', 'ShaderCost'],
                  group: 'optimization',
                  note: 'Material instruction counts and overdraw. Cheap-looking materials layered on translucency are a common frame-time sink.',
                },
              ],
            },
          ],
        },
      ],
    },
  },
];

export const getGraph = (slug) => graphs.find((g) => g.slug === slug);
