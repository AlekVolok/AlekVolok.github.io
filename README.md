# alekvolok.github.io — portfolio

Personal portfolio of Aleksandr Kozlov, technical artist. Built with
[Astro](https://astro.build) and hand-written WebGL2 shader demos.

## Commands

| Command           | Action                                    |
| ----------------- | ----------------------------------------- |
| `npm install`     | Install dependencies                      |
| `npm run dev`     | Dev server at `localhost:4321`            |
| `npm run build`   | Production build into `./dist/`           |
| `npm run preview` | Preview the production build locally      |

## Editing content

- **Projects** — [`src/data/projects.js`](src/data/projects.js): one object per
  card; `featured: true` shows it on the home page.
- **Shader demos** — [`src/data/shaders.js`](src/data/shaders.js): each entry is
  Shadertoy-compatible GLSL (`mainImage`, `iTime`, `iResolution`, `iMouse`), so
  you can paste most Shadertoy image shaders straight in.
- **Blog posts** — Markdown files in [`src/content/blog/`](src/content/blog/)
  with `title`, `description`, `date`, `tags` frontmatter. Images go in
  `public/images/`.
- **Name / links / tagline** — [`src/data/site.js`](src/data/site.js).

## Deploying

Push to the `main` branch of the `AlekVolok/AlekVolok.github.io` repository.
The GitHub Actions workflow in `.github/workflows/deploy.yml` builds the site
and publishes it to GitHub Pages (set Pages → Source to "GitHub Actions" in
the repo settings once).
