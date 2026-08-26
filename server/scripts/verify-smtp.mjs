import { verifySmtpTransport } from "../src/lib/email.js";

try {
  await verifySmtpTransport();
  console.log("SMTP VERIFY SUCCESS");
} catch (error) {
  console.error(`SMTP VERIFY FAILED: ${error?.code || "UNKNOWN"} ${error?.message || "Unknown error"}`);
  process.exitCode = 1;
}
