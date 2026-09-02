// Verifies SMTP_URL / EMAIL_FROM by connecting to the provider and optionally
// sending a test message. Usage: node --env-file=.env scripts/smtp-check.mjs [to]
import nodemailer from "nodemailer";

const url = process.env.SMTP_URL;
const from = process.env.EMAIL_FROM;
const to = process.argv[2];

if (!url) {
  console.error("SMTP_URL is not set");
  process.exit(1);
}

const parsed = new URL(url);
console.log("host:", parsed.hostname);
console.log("port:", parsed.port || "(default)");
console.log("protocol:", parsed.protocol);
console.log("user:", decodeURIComponent(parsed.username));
console.log("password length:", decodeURIComponent(parsed.password).length);
console.log("from:", from ?? "(unset)");

const transport = nodemailer.createTransport(url);

try {
  await transport.verify();
  console.log("\nverify: OK — credentials accepted");
} catch (err) {
  console.error("\nverify FAILED:", err.message);
  process.exit(1);
}

if (to) {
  try {
    const info = await transport.sendMail({
      from: from ?? decodeURIComponent(parsed.username),
      to,
      subject: "StrideVote SMTP test",
      text: "If you can read this, SMTP delivery works.",
    });
    console.log("sent:", info.messageId, info.response ?? "");
  } catch (err) {
    console.error("send FAILED:", err.message);
    process.exit(1);
  }
}
