# llm-pipeline

A project that uses:

- d3 in canvas
- markdown in HTML
- next.js
- Roboto Condensed font

## behavior

- shows markdown editor (and renderer) in HTML
- surrounds the text with rounded rect with Title in canvas d3: text becomes a node
- when a new node is created: a title is created with a nice random name. it becomes a variable for the whole diagram (should not have spaces because it enters lisp formulae - do not admit spaces in titles at edit time)
- the nodes connect by edges (curves) like the SVG: "m84,159.5c126,3 118,80 226,84"
- the background is pannable, zoomable at mouse pos
- the nodes are draggable, selectable
- pan, zoon, drag have sync effects in both canvas and HTML divs. at a certain threshhold of zoom (where text is unreadable): the whole node becomes the title

## types

- the overall type of a diagram is JSON 5
- a JSON atom can be:
  - a Markdown text: it it begins with a letter or # or - or *, etc.
  - a number in decimal: if it begins with a digit or . and it can be parsed whole into a float
  - hexadecimal: 0x
  - a boolean: if it is true, false
  - a lisp function: if it begins with ( and ends with )
- a JSON container can be:
  - an array: if it begins with [ and ends with ]
  - an object/diagram: if it begins with { and ends with}

## location live

http://localhost:3000/

## AI prompt providers

The Settings overlay supports three execution modes for `(prompt chatgpt ...)`:

- OpenAI API: calls the Responses API from the browser with an API key kept in session storage.
- Local Playwright: uses this app's local Next.js API routes and dedicated Chrome profile.
- Remote Playwright: calls a separately hosted copy of the Playwright API routes.

For a remote Playwright service, configure:

```sh
PLAYWRIGHT_ALLOWED_ORIGINS=https://OWNER.github.io
PLAYWRIGHT_SERVICE_TOKEN=replace-with-a-long-random-token
```

Multiple allowed origins can be comma-separated. Enter the same service URL and bearer token
in Settings on the GitHub Pages frontend.

## GitHub Pages deployment

The repository includes `.github/workflows/deploy-pages.yml`. It creates a static Next.js
export and deploys it whenever `main` is pushed.

1. Create a GitHub repository and push this project.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**. This one-time
   repository setting creates/enables the Pages site.
4. Push `main` or rerun the failed **Deploy GitHub Pages** workflow.

The workflow intentionally does not call `actions/configure-pages`: that action cannot enable
a new Pages site with the normal workflow `GITHUB_TOKEN`. Automatic first-time enablement
would require storing a separate personal access token with Pages write permission.

The build derives the correct base path from `GITHUB_REPOSITORY`, so both project sites
(`https://OWNER.github.io/REPOSITORY/`) and user sites (`https://OWNER.github.io/`) work.
The static deployment omits the local Node/Playwright routes. Hosted users can select either
OpenAI API or Remote Playwright in Settings.

To test the same export locally:

```sh
npm run build:pages
```

The generated site is written to `site/`. This is the directory uploaded and served by
the GitHub Pages workflow.
