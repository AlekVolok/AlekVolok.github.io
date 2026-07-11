/**
 * Project cards shown on the home page and the Work page.
 * Edit freely — `image` is optional (path under /public), `link` is optional.
 * Set `featured: true` to surface a project on the home page.
 */

export const projects = [
  {
    title: 'Tree Skeleton Detection',
    description:
      'Extracting branch skeletons from scanned tree geometry — point cloud processing and graph-based reconstruction for procedural vegetation workflows.',
    tags: ['Python', 'Geometry Processing', 'Point Clouds'],
    link: 'https://github.com/AlekVolok',
    featured: true,
  },
  {
    title: 'Houdini Volumes × NumPy',
    description:
      'Fast volume manipulation in Houdini through NumPy — bypassing VEX for array-heavy workloads like slicing, remapping and ML preprocessing.',
    tags: ['Houdini', 'Python', 'NumPy', 'Volumes'],
    link: '/blog/houdini-volumes-numpy',
    featured: true,
  },
  {
    title: 'Shader Lab',
    description:
      'A collection of live GLSL experiments running right in the browser — raymarched SDFs, fractals and volumetric rendering on a WebGL2 canvas.',
    tags: ['GLSL', 'WebGL2', 'Raymarching'],
    link: '/lab',
    featured: true,
  },
  {
    title: 'Dutch Vocabulary Trainer',
    description:
      'A small web app for topic-based language drilling, backed by a JSON word database — built to make daily Dutch practice frictionless.',
    tags: ['JavaScript', 'Web App'],
    link: 'https://github.com/AlekVolok',
    featured: false,
  },
];
