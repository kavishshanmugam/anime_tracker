// No-op code signing — skips the winCodeSign download that fails without
// Developer Mode or Admin privileges (symlink creation error).
// This app doesn't need code signing.
exports.default = async function () {}
