# Static Gaussian BP Grid Demo

This is a pure frontend GitHub Pages version.

Files:
- `index.html`: UI and CSS
- `gbp_static.js`: Gaussian BP, shortcut logic, metrics, and MAP solve in browser

How to publish on GitHub Pages:
1. Create a GitHub repository.
2. Upload `index.html` and `gbp_static.js` to the repository root.
3. In GitHub, open Settings -> Pages.
4. Choose branch `main` and root folder `/`.
5. Open the generated GitHub Pages URL.

Notes:
- Gaussian BP runs entirely in the browser.
- The MAP reference is solved once at build time using frontend banded sparse Cholesky for the base grid system.
- If a non-grid reference solve is requested internally, the code falls back to preconditioned CG.
- Manual shortcuts persist; dynamic random refreshes only replace random shortcuts.
