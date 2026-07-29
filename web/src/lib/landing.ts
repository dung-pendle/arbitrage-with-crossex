/** Landing-build constants. IS_LANDING is true only under
 * `vite build --mode landing` (see vite.config.ts define); the terminal build
 * leaves VITE_LANDING unset so every landing branch is inert. */
export const IS_LANDING = import.meta.env.VITE_LANDING === '1';

export const REPO_URL = 'https://github.com/mrenoon/boros-crossex-terminal';

/** Verbatim from README "Install (macOS)" — the one command a visitor runs. */
export const INSTALL_CMD =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/mrenoon/boros-crossex-terminal/main/install.sh)"';

export const LOCAL_APP_URL = 'http://localhost:6688';
