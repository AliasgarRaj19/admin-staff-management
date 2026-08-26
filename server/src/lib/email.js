import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const requiredSettings = ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM"];
const smtpState = globalThis.__adminStaffSmtpState ?? { transport: null, signature: null };
if (!globalThis.__adminStaffSmtpState) {
  globalThis.__adminStaffSmtpState = smtpState;
}

export class EmailDeliveryError extends Error {
  constructor(message = "Unable to deliver email.") {
    super(message);
    this.name = "EmailDeliveryError";
    this.code = "EMAIL_DELIVERY_FAILED";
  }
}

function isProductionLike() {
  return env.NODE_ENV === "production";
}

function normalizeHost(value) {
  return String(value ?? "").trim();
}

function normalizePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : null;
}

function normalizeSecure(value) {
  return String(value ?? "").toLowerCase() === "true";
}

function getSmtpSettings() {
  const host = normalizeHost(process.env.SMTP_HOST);
  const port = normalizePort(process.env.SMTP_PORT);
  const secure = normalizeSecure(process.env.SMTP_SECURE);
  const user = normalizeHost(process.env.SMTP_USER);
  const pass = String(process.env.SMTP_PASSWORD ?? "");
  const from = normalizeHost(process.env.SMTP_FROM);

  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!port) missing.push("SMTP_PORT");
  if (!from) missing.push("SMTP_FROM");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASSWORD");
  if (process.env.SMTP_SECURE == null) missing.push("SMTP_SECURE");

  if (missing.length) {
    const uniqueMissing = [...new Set(missing)];
    if (isProductionLike()) {
      throw new EmailDeliveryError(`SMTP configuration is incomplete: ${uniqueMissing.join(", ")}.`);
    }
    return null;
  }

  return { host, port, secure, user, pass, from };
}

function buildTransportSignature(settings) {
  if (!settings) return "smtp:disabled";
  return JSON.stringify({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    user: settings.user,
    from: settings.from,
  });
}

export function createSmtpTransport(settings = getSmtpSettings()) {
  if (!settings) return null;
  return nodemailer.createTransport(buildSmtpTransportOptions(settings));
}

export function buildSmtpTransportOptions(settings = getSmtpSettings()) {
  if (!settings) return null;
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: {
      user: settings.user,
      pass: settings.pass,
    },
  };
}

export function buildInvitationMessage({ email, url, roleName, expiresInHours }) {
  const safeRoleName = String(roleName ?? "Moderator").trim() || "Moderator";
  const safeEmail = String(email ?? "").trim();
  const safeUrl = String(url ?? "").trim();
  const expiryLabel = Number.isFinite(Number(expiresInHours)) ? `This link expires in ${Number(expiresInHours)} hours.` : "This link expires soon.";
  const subject = `Invitation to join Admin + Staff Management System`;
  const text = [
    `Hello ${safeEmail},`,
    "",
    `You have been invited as ${safeRoleName}.`,
    `Open this link to complete registration: ${safeUrl}`,
    expiryLabel,
    "",
    "If you were not expecting this invitation, you can ignore this email.",
  ].join("\n");
  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
      <p>Hello ${safeEmail},</p>
      <p>You have been invited as <strong>${safeRoleName}</strong>.</p>
      <p><a href="${safeUrl}">Complete your registration</a></p>
      <p>${expiryLabel}</p>
      <p>If you were not expecting this invitation, you can ignore this email.</p>
    </div>
  `;
  return { subject, text, html };
}

export async function sendEmail(message, { transport = null, from = null, logger = console } = {}) {
  const settings = transport ? null : getSmtpSettings();
  if (!transport && !settings) {
    logger?.warn?.("SMTP not configured; invitation email skipped.");
    return { ok: false, skipped: true, reason: "SMTP_NOT_CONFIGURED" };
  }

  const activeTransport = transport || createSmtpTransport(settings);
  const sender = from || settings?.from;
  try {
    const info = await activeTransport.sendMail({ from: sender, ...message });
    logger?.info?.("SMTP invitation email sent.", { to: message.to, messageId: info?.messageId || null });
    return { ok: true, info };
  } catch (error) {
    logger?.error?.("SMTP invitation email failed.", { to: message.to, code: error?.code || null });
    throw new EmailDeliveryError("Unable to deliver invitation email.");
  }
}

export async function sendInvitationEmail({ email, url, roleName, expiresInHours }, options = {}) {
  const message = buildInvitationMessage({
    email,
    url,
    roleName,
    expiresInHours,
  });
  return sendEmail(
    {
      to: String(email ?? "").trim(),
      subject: message.subject,
      text: message.text,
      html: message.html,
    },
    options,
  );
}

export async function verifySmtpTransport({ transport = null } = {}) {
  const settings = transport ? null : getSmtpSettings();
  if (!transport && !settings) {
    throw new EmailDeliveryError("SMTP configuration is incomplete.");
  }
  const activeTransport = transport || createSmtpTransport(settings);
  await activeTransport.verify();
  return true;
}

export function resetSmtpTransportForTests() {
  smtpState.transport = null;
  smtpState.signature = null;
}

export function getDefaultSmtpTransport() {
  const settings = getSmtpSettings();
  const signature = buildTransportSignature(settings);
  if (smtpState.transport && smtpState.signature === signature) {
    return smtpState.transport;
  }
  const transport = createSmtpTransport(settings);
  smtpState.transport = transport;
  smtpState.signature = signature;
  return transport;
}

export const sendInvitationEmailDefault = sendInvitationEmail;
