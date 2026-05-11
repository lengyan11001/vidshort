const API_ORIGIN = "https://api.vidshort.uk";

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);
    if (!incomingUrl.pathname.startsWith("/api/")) {
      return new Response("Not found", { status: 404 });
    }

    const targetUrl = new URL(API_ORIGIN);
    targetUrl.pathname = incomingUrl.pathname;
    targetUrl.search = incomingUrl.search;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.set("x-forwarded-host", incomingUrl.host);
    headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));

    const init = {
      method: request.method,
      headers,
      redirect: "manual"
    };

    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = request.body;
    }

    return fetch(new Request(targetUrl, init));
  }
};
