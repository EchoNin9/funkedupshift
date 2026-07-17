// Local dev config. Loaded by index.html after inline placeholders.
// For local dev: set API_BASE_URL below to your staging API URL.
// Get it with: terraform -chdir=infra output -raw apiInvokeUrl
// Deploy: CI overwrites this file with terraform outputs.
(function () {
  var placeholder = 'API_URL_PLACEHOLDER';
  var url = window.API_BASE_URL;
  if (!url || url === placeholder) {
    window.API_BASE_URL = '';  // Set to your API URL for local dev, e.g. 'https://xxx.execute-api.us-east-1.amazonaws.com'
  }
  if (!window.COGNITO_USER_POOL_ID || window.COGNITO_USER_POOL_ID === 'POOL_ID_PLACEHOLDER') {
    window.COGNITO_USER_POOL_ID = '';
  }
  if (!window.COGNITO_CLIENT_ID || window.COGNITO_CLIENT_ID === 'CLIENT_ID_PLACEHOLDER') {
    window.COGNITO_CLIENT_ID = '';
  }
})();
