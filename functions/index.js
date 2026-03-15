const { onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

exports.myFirstBackendFunction = onCall((request) => {
  logger.info("Function was called!", { structuredData: true });
  
  // This is what the function returns to your Angular app
  return { message: "Hello from the backend!" };
});