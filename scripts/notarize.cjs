const path = require("path");
const { notarize } = require("@electron/notarize");

exports.default = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  const appleApiKey = process.env.APPLE_API_KEY;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;

  if (!appleApiKey || !appleApiKeyId || !appleApiIssuer) {
    console.log("[notarize] Skipping notarization: APPLE_API_KEY, APPLE_API_KEY_ID, or APPLE_API_ISSUER is missing.");
    return;
  }

  console.log(`[notarize] Submitting ${appPath} for notarization...`);
  await notarize({
    appBundleId: packager.appInfo.id,
    appPath,
    appleApiKey,
    appleApiKeyId,
    appleApiIssuer,
  });
  console.log("[notarize] Notarization completed.");
};
