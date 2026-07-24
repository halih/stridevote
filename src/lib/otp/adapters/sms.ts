import { channelEnabled } from "@/lib/env";
import { pushDevMessage } from "../dev-inbox";
import type { OtpChannel } from "../channel";

// SMS OTP is stubbed until a sender number is leased + A2P 10DLC registered.
// The intended production adapter is AWS End User Messaging (own-OTP: we generate
// the code and store it in OtpChallenge, no per-verification Verify fee). Drop the
// real send() body in here and it works with the rest of the flow unchanged.
export const smsChannel: OtpChannel = {
  kind: "sms",
  enabled: channelEnabled("sms"),
  live: false,
  async send(to, { code }) {
    if (!code) throw new Error("sms channel requires a code");
    console.log(`\n\uD83D\uDCF1 [StrideVote][sms] -> ${to}: code ${code}\n`);
    pushDevMessage({ at: Date.now(), kind: "sms", to, code });
  },
};
