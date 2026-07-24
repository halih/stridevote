import { channelEnabled } from "@/lib/env";
import { pushDevMessage } from "../dev-inbox";
import type { OtpChannel } from "../channel";

// WhatsApp OTP is stubbed until a WhatsApp Business Account + approved
// Authentication template exists (Meta Cloud API or a BSP). Same own-OTP flow as
// SMS: we generate the code, store it in OtpChallenge, and would send it inside
// the authentication template here.
export const whatsappChannel: OtpChannel = {
  kind: "whatsapp",
  enabled: channelEnabled("whatsapp"),
  live: false,
  async send(to, { code }) {
    if (!code) throw new Error("whatsapp channel requires a code");
    console.log(`\n\uD83D\uDFE2 [StrideVote][whatsapp] -> ${to}: code ${code}\n`);
    pushDevMessage({ at: Date.now(), kind: "whatsapp", to, code });
  },
};
