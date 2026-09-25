export const URLS = {
  siteOrigin: "https://www.cinemasunshine.co.jp",
  siteHome: "https://www.cinemasunshine.co.jp/",
  loginOrigin: "https://login.member.cinemasunshine.co.jp",
  loginPath: "/login",
  authPath: "/auth",
  authOrigin: "https://auth.smart-theater.com",
  transactionOrigin: "https://transaction.ticket-cinemasunshine.com",
  purchaseBase:
    "https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction",
} as const;

export const LOGIN_HOSTS = ["login.member.cinemasunshine.co.jp"] as const;
export const AUTH_HOSTS = ["auth.smart-theater.com"] as const;

export const SELECTORS = {
  login: {
    emailInput: 'input[name="email"]',
    passwordInput: 'input[name="password"]',
    submitButton: { role: "button" as const, name: "ログインする" },
  },
  seat: {
    seat: "div.seat",
    seatTypes: ".seat-types",
    seatTypesItem: ".seat-types li",
    seatInfo: ".seat-info",
    screen: 'img[src*="/screen/"]',
  },
} as const;

export const SEAT_STATE_URL_FRAGMENT = "/api/purchase/getSeatState";
export const THEATER_LAYOUT_URL_FRAGMENT = "/json/theater/";

export const TEXT_PATTERNS = {
  sessionExpired: [
    "セッションの有効期限",
    "有効期限が切れ",
    "取引の有効期限",
    "タイムアウトしました",
  ],
  congested: ["アクセスが集中", "混雑して", "順番にご案内", "待合室"],
  duplicateTransaction: ["既にお手続き中", "他のお手続き", "重複したお手続き", "すでに座席"],
  error: ["エラーが発生しました", "問題が発生しました"],
  authError: ["イベント情報取得エラー", "アクセス集中", "混雑しております", "エラーが発生しました"],
} as const;
