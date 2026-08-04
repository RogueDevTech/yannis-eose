/**
 * Channel-agnostic outbound message provider.
 *
 * The automation engine renders a message and hands it to a provider without
 * knowing which channel it is (email / SMS / WhatsApp). Adding a new channel is
 * one class implementing this interface — the engine never changes.
 *
 * This is intentionally NOT the VOIP `VoipProvider` interface, which is
 * voice-call-specific (initiateCall / webhook status mapping).
 */

export type AutomationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

/** A fully-resolved recipient + rendered content, ready to transmit. */
export interface ChannelSendRequest {
  /** Raw destination — email address or E.164 phone. Server-side only; never surfaced to a viewer. */
  to: string;
  /** Optional subject line (email only; ignored by SMS/WhatsApp). */
  subject?: string;
  /** Rendered message body after placeholder substitution. */
  body: string;
  /** Optional HTML body for email. Falls back to `body` as plain text. */
  html?: string;
}

export interface ChannelSendResult {
  success: boolean;
  /** Provider-side id when the transport returns one (message id, etc.). */
  providerMessageId?: string;
  /** Populated when success is false. */
  error?: string;
}

export interface MessageChannelProvider {
  /** The channel this provider serves. */
  readonly channel: AutomationChannel;
  /** True when the required credentials/config are present. Sends are skipped (not errored) when false. */
  isConfigured(): boolean;
  /** Transmit one message. Implementations must never throw for a normal delivery failure — return {success:false}. */
  send(req: ChannelSendRequest): Promise<ChannelSendResult>;
}
