(function () {
  const mockOpenIdKey = "reelpilot_mock_openid";

  function getMockOpenId() {
    let openId = localStorage.getItem(mockOpenIdKey);
    if (!openId) {
      openId = `mock_openid_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
      localStorage.setItem(mockOpenIdKey, openId);
    }
    return openId;
  }

  async function loadConfig() {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Config unavailable");
    return response.json();
  }

  function hasTTMinis() {
    return typeof window.TTMinis !== "undefined";
  }

  function callTTMinis(method, payload) {
    return new Promise((resolve, reject) => {
      if (!hasTTMinis() || typeof window.TTMinis[method] !== "function") {
        reject(new Error(`${method} is unavailable`));
        return;
      }
      try {
        const result = window.TTMinis[method]({
          ...(payload || {}),
          success: resolve,
          fail: reject
        });
        if (result && typeof result.then === "function") result.then(resolve).catch(reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  async function init() {
    const config = await loadConfig();
    const clientKey = config.client?.clientKey;
    if (hasTTMinis() && clientKey && clientKey !== "replace_with_client_key") {
      window.TTMinis.init({ clientKey });
      try {
        await callTTMinis("setNavigationBarColor", {
          frontColor: "#ffffff",
          backgroundColor: "#090a0d"
        });
      } catch (_) {
        // Optional capability.
      }
    }
    return config;
  }

  async function login() {
    if (hasTTMinis()) {
      const result = await callTTMinis("login");
      return {
        provider: "ttminis",
        code: result.code,
        openId: result.openId || null
      };
    }
    return {
      provider: "mock",
      code: `mock_code_${Date.now()}`,
      openId: getMockOpenId()
    };
  }

  async function authorizeProfile(currentUser) {
    if (hasTTMinis()) {
      await callTTMinis("authorize", { scope: "user_info" });
      const profile = await callTTMinis("getUserInfo");
      return {
        name: profile.userInfo?.nickName || profile.userInfo?.displayName || currentUser?.name || "Guest",
        avatar: profile.userInfo?.avatarUrl || currentUser?.avatar || "G"
      };
    }
    return {
      name: currentUser?.name && currentUser.name !== "Guest" ? currentUser.name : "Avery",
      avatar: currentUser?.avatar || "A"
    };
  }

  async function showRewardedAd(adUnitId) {
    if (hasTTMinis()) {
      const ad = window.TTMinis.createRewardedVideoAd({ adUnitId });
      return new Promise((resolve, reject) => {
        ad.onClose((result) => resolve({ completed: Boolean(result?.isEnded), raw: result }));
        ad.onError((error) => reject(error));
        ad.load()
          .then(() => ad.show())
          .catch(reject);
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 650));
    return { completed: true, raw: { mock: true } };
  }

  async function createSubscription(payload) {
    if (hasTTMinis() && typeof window.TTMinis.createSubscription === "function") {
      return callTTMinis("createSubscription", payload);
    }
    return { status: "active", mock: true };
  }

  window.TTMinisAdapter = {
    init,
    login,
    authorizeProfile,
    showRewardedAd,
    createSubscription,
    hasTTMinis
  };
})();
