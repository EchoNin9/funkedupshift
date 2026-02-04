(function () {
  var poolId = window.COGNITO_USER_POOL_ID;
  var clientId = window.COGNITO_CLIENT_ID;
  var currentUser = null;
  var currentSession = null;

  if (!poolId || !clientId) {
    console.warn('Cognito config not set');
    return;
  }

  // Use Amazon Cognito Identity SDK from CDN
  var CognitoUserPool = window.AmazonCognitoIdentity.CognitoUserPool;
  var CognitoUser = window.AmazonCognitoIdentity.CognitoUser;
  var AuthenticationDetails = window.AmazonCognitoIdentity.AuthenticationDetails;
  var CognitoUserAttribute = window.AmazonCognitoIdentity.CognitoUserAttribute;

  var poolData = {
    UserPoolId: poolId,
    ClientId: clientId
  };
  var userPool = new CognitoUserPool(poolData);

  function getCurrentUser() {
    return userPool.getCurrentUser();
  }

  function getSession(callback) {
    var user = getCurrentUser();
    if (!user) {
      callback(null);
      return;
    }
    user.getSession(function (err, session) {
      if (err) {
        callback(null);
        return;
      }
      callback(session);
    });
  }

  window.auth = {
    signUp: function (email, password, callback) {
      var attributeList = [
        new CognitoUserAttribute({ Name: 'email', Value: email })
      ];
      userPool.signUp(email, password, attributeList, null, function (err, result) {
        if (err) {
          callback(err);
          return;
        }
        callback(null, result);
      });
    },

    signIn: function (email, password, callback) {
      var authenticationDetails = new AuthenticationDetails({
        Username: email,
        Password: password
      });
      var cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool
      });
      cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: function (result) {
          callback(null, result);
        },
        onFailure: function (err) {
          callback(err);
        }
      });
    },

    signOut: function () {
      var user = getCurrentUser();
      if (user) {
        user.signOut();
      }
      currentUser = null;
      currentSession = null;
    },

    getAccessToken: function (callback) {
      getSession(function (session) {
        if (!session || !session.isValid()) {
          callback(null);
          return;
        }
        callback(session.getIdToken().getJwtToken());
      });
    },

    isAuthenticated: function (callback) {
      getSession(function (session) {
        callback(session !== null && session.isValid());
      });
    },

    getCurrentUserEmail: function (callback) {
      var user = getCurrentUser();
      if (!user) {
        callback(null);
        return;
      }
      user.getSession(function (err, session) {
        if (err || !session) {
          callback(null);
          return;
        }
        user.getUserAttributes(function (err, attributes) {
          if (err) {
            callback(null);
            return;
          }
          var email = attributes.find(function (attr) { return attr.Name === 'email'; });
          callback(email ? email.Value : null);
        });
      });
    }
  };
})();
