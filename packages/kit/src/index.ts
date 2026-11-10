export type { AuthConfig, UserInfo, LoginMode, TeamMembership, TeamMember, Invitation, PendingInvitation, ApiError } from './types.js';
export type { Plan, PlanPrice, Subscription, Licenses, GrantLicenseResult, CatalogItem, Order, OrderStatus, OrderLineItem } from './types.js';
export { isValidApiBaseUrl, setToken, getToken, clearToken, getTokenExpiry, getTokenClaims, apiFetch } from './client.js';
export { register, verify, buildVerifyUrl, login, logout, checkSession, getUserInfo, renewToken, scheduleRefresh, cancelRefresh, applyBearerDelivery } from './auth.js';
export { invite, getInvitation, activate, acceptInvite, resendInvite, listInvitations } from './invite.js';
export { getTeams, switchTeam, listTeamMembers, removeMember, updateMemberRole, createTeam, updateTeam, deleteTeam } from './team.js';
export { forgotPassword, resetPassword } from './password.js';
export { updateProfile, updateUser, changePassword } from './profile.js';
export { acceptConsents } from './consents.js';
export {
  getPlans,
  getSubscription,
  createCheckoutSession,
  openBillingPortal,
  getLicenses,
  grantLicense,
  revokeLicense,
  waitForSubscription,
  WaitTimeoutError,
} from './payments.js';
export type { WaitOptions } from './payments.js';
export { getCatalog, getCatalogItem, createOrder, getOrder, waitForOrder, readOrderRef, clearOrderRef } from './orders.js';
export type { OrderRef, CatalogQuery, OrderItem } from './orders.js';
export {
  addToCart,
  setCartQuantity,
  removeFromCart,
  cartTotals,
  toOrderItems,
  loadCart,
  saveCart,
  clearStoredCart,
  DEFAULT_CART_STORAGE_KEY,
} from './cart.js';
export type { CartLine, CartItem, CartTotals } from './cart.js';
export { formatPrice } from './money.js';
