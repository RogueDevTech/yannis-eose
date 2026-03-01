// ============================================
// Yannis EOSE — tRPC Shared Types
// ============================================
// The AppRouter type is re-exported from the API.
// Remix imports this type to create a fully-typed tRPC client.
// This avoids importing API code directly — only the TYPE is shared.
// ============================================

export type { AppRouter } from '../../../apps/api/src/trpc/routers';
