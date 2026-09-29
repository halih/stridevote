import { redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { TopBar } from "@/components/TopBar";
import { ProfileForm, type ProfileInitial } from "@/components/profile/ProfileForm";

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const initials = user.initials || initialsFor(user.name);

  const initial: ProfileInitial = {
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    phone: user.phone ?? "",
    phoneOptional: Boolean(user.email?.trim()),
    area: user.area,
    homeLat: user.homeLat,
    homeLng: user.homeLng,
    city: user.city ?? "",
    state: user.state ?? "",
    postalCode: user.postalCode ?? "",
    addressLine: user.addressLine ?? "",
    locationSource: (user.locationSource as ProfileInitial["locationSource"]) ?? null,
  };

  return (
    <>
      <TopBar title="Your profile" subtitle={user.email ?? user.phone ?? "Signed in"} initials={initials} />
      <div className="content">
        <div className="card">
          <ProfileForm initial={initial} />
        </div>
      </div>
    </>
  );
}
