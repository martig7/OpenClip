# Common Agent Errors

    - When trying to run the ENTIRE test set, make sure to run `npm run test` from the electron-app folder instead of something like `npx vitest run` because we include playwright tests which test important functionality/integration with OBS.
    - When you add API endpoints, make sure to also update the mock API.
    - Do not commit random specs and plans.

# Known Issues

    - OBS updates frequently cause the plugin to appear as "missing" in the OBS plugin manager. This is not a code bug — reinstalling OBS (the app, not just the plugin) fixes it. The likely cause is that in-place OBS updates don't re-run the installer's DLL directory registration step, so Windows can't resolve our delay-loaded obs.dll/obs-frontend-api.dll at plugin load time. OBS 32.1.0 also introduced a new plugin manager that surfaces these previously-silent load failures. When testing after an OBS update, reinstall OBS first.
