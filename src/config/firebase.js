/**
 * Firebase Cloud Messaging (FCM) / Push Notification Configuration & Provider Boundary
 *
 * Provides a resilient abstraction for push notifications. If Firebase Admin credentials
 * are provided in the environment, it initializes the real Firebase Admin SDK.
 * Otherwise, it activates a production-safe Mock Provider that records and logs
 * notifications without failing or blocking operations.
 */

const logger = require('./logger');

class MockPushProvider {
  constructor() {
    this.name = 'MockPushProvider';
    this.sentNotifications = [];
    logger.info('[FCM] Initialized MockPushProvider (no external Firebase credentials required)');
  }

  async sendPushNotification({ token, title, body, data = {} }) {
    const record = {
      token,
      notification: { title, body },
      data,
      timestamp: new Date().toISOString()
    };
    this.sentNotifications.push(record);
    logger.debug({ token: token ? `${token.slice(0, 8)}...` : 'none', title }, '[FCM Mock] Push notification sent');
    return { success: true, messageId: `mock-msg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}` };
  }

  async sendMulticast({ tokens, title, body, data = {} }) {
    if (!tokens || !tokens.length) {
      return { successCount: 0, failureCount: 0, responses: [] };
    }

    const responses = [];
    for (const token of tokens) {
      const res = await this.sendPushNotification({ token, title, body, data });
      responses.push(res);
    }

    return {
      successCount: responses.filter(r => r.success).length,
      failureCount: 0,
      responses
    };
  }

  getSentNotifications() {
    return [...this.sentNotifications];
  }

  clearSentNotifications() {
    this.sentNotifications = [];
  }
}

class FirebasePushProvider {
  constructor(adminApp) {
    this.name = 'FirebasePushProvider';
    this.admin = adminApp;
    logger.info('[FCM] Initialized FirebasePushProvider with live credentials');
  }

  async sendPushNotification({ token, title, body, data = {} }) {
    if (!token) {
      return { success: false, error: 'No device token provided' };
    }

    const payload = {
      token,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
      )
    };

    try {
      const response = await this.admin.messaging().send(payload);
      return { success: true, messageId: response };
    } catch (err) {
      logger.error({ err: err.message, token: token.slice(0, 8) }, '[FCM] Failed to send push notification');
      return { success: false, error: err.message };
    }
  }

  async sendMulticast({ tokens, title, body, data = {} }) {
    if (!tokens || !tokens.length) {
      return { successCount: 0, failureCount: 0, responses: [] };
    }

    const payload = {
      tokens,
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
      )
    };

    try {
      const batchResponse = await this.admin.messaging().sendEachForMulticast(payload);
      return {
        successCount: batchResponse.successCount,
        failureCount: batchResponse.failureCount,
        responses: batchResponse.responses
      };
    } catch (err) {
      logger.error({ err: err.message }, '[FCM] Failed to send multicast push');
      return { successCount: 0, failureCount: tokens.length, error: err.message };
    }
  }
}

let pushProvider;

function initPushProvider() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (serviceAccountJson || credentialsPath) {
    try {
      // Attempt to dynamically load firebase-admin if available
      const admin = require('firebase-admin');
      let credential;

      if (serviceAccountJson) {
        credential = admin.credential.cert(JSON.parse(serviceAccountJson));
      } else {
        credential = admin.credential.applicationDefault();
      }

      if (!admin.apps.length) {
        admin.initializeApp({ credential });
      }

      return new FirebasePushProvider(admin);
    } catch (err) {
      logger.warn({ err: err.message }, '[FCM] Failed to load firebase-admin. Falling back to MockPushProvider.');
      return new MockPushProvider();
    }
  }

  return new MockPushProvider();
}

pushProvider = initPushProvider();

module.exports = {
  pushProvider,
  MockPushProvider,
  FirebasePushProvider,
  sendPushNotification: (params) => pushProvider.sendPushNotification(params),
  sendMulticast: (params) => pushProvider.sendMulticast(params)
};
