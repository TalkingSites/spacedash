// SpaceDash dev build, rebuilt on every save: http://localhost:8093/spacedash.js
// A SpaceClub site's /admin/ on localhost uses it instead of the CDN while this runs.
module.exports = {
  apps: [{ name: 'spacedash', script: 'npm', args: 'run dev', cwd: __dirname }],
};
