"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { Map } from "@/components/map/Map";
import { resolveLocation, updateProfile } from "@/lib/profile-actions";
import { doSignOut } from "@/lib/actions";

type Method = "address" | "city" | "zip" | "gps";

export interface ProfileInitial {
  firstName: string;
  lastName: string;
  phone: string;
  area: string | null;
  homeLat: number | null;
  homeLng: number | null;
  city: string;
  state: string;
  postalCode: string;
  addressLine: string;
  locationSource: Method | null;
}

interface Resolved {
  lat: number;
  lng: number;
  label: string;
}

const METHODS: { id: Method; label: string }[] = [
  { id: "address", label: "Address" },
  { id: "city", label: "City / State" },
  { id: "zip", label: "ZIP" },
  { id: "gps", label: "Current" },
];

export function ProfileForm({ initial }: { initial: ProfileInitial }) {
  const router = useRouter();
  const toast = useToast();
  const [saving, startSaving] = useTransition();
  const [locating, setLocating] = useState(false);

  const [firstName, setFirstName] = useState(initial.firstName);
  const [lastName, setLastName] = useState(initial.lastName);
  const [phone, setPhone] = useState(initial.phone);

  const [method, setMethod] = useState<Method>(initial.locationSource ?? "address");
  const [address, setAddress] = useState(initial.addressLine);
  const [city, setCity] = useState(initial.city);
  const [stateCode, setStateCode] = useState(initial.state || "WA");
  const [zip, setZip] = useState(initial.postalCode);

  const [resolved, setResolved] = useState<Resolved | null>(
    initial.homeLat != null && initial.homeLng != null
      ? { lat: initial.homeLat, lng: initial.homeLng, label: initial.area ?? "Saved location" }
      : null,
  );

  async function runResolve(payload: {
    method: Method;
    query?: string;
    lat?: number;
    lng?: number;
  }) {
    setLocating(true);
    try {
      const res = await resolveLocation(payload);
      if (res.ok && res.lat != null && res.lng != null) {
        setResolved({ lat: res.lat, lng: res.lng, label: res.label ?? "Location" });
      } else {
        toast(res.message);
      }
    } finally {
      setLocating(false);
    }
  }

  function findLocation() {
    if (method === "gps") {
      if (!("geolocation" in navigator)) {
        toast("Your device doesn't support location sharing.");
        return;
      }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void runResolve({
            method: "gps",
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
        },
        () => {
          setLocating(false);
          toast("Couldn't get your location. Check browser permissions.");
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
      return;
    }

    const query =
      method === "city" ? [city, stateCode].filter(Boolean).join(", ") : method === "zip" ? zip : address;
    if (!query.trim()) {
      toast("Enter a location to search.");
      return;
    }
    void runResolve({ method, query });
  }

  function save() {
    startSaving(async () => {
      const location = resolved
        ? {
            lat: resolved.lat,
            lng: resolved.lng,
            label: resolved.label,
            source: method,
            addressLine: method === "address" ? address.trim() || undefined : undefined,
            city: method === "city" ? city.trim() || undefined : undefined,
            state: method === "city" ? stateCode.trim() || undefined : undefined,
            postalCode: method === "zip" ? zip.trim() || undefined : undefined,
          }
        : null;
      const res = await updateProfile({ firstName, lastName, phone, location });
      toast(res.message);
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="form">
      <div className="form-two">
        <div className="form-field">
          <label className="field-label">First name</label>
          <input className="field" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="field-label">Last name</label>
          <input className="field" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
      </div>
      <div className="form-field">
        <label className="field-label">Phone number</label>
        <input
          className="field"
          type="tel"
          value={phone}
          placeholder="(206) 555-0134"
          autoComplete="tel"
          onChange={(e) => setPhone(e.target.value)}
        />
        <p className="field-hint" style={{ marginTop: 6 }}>
          Optional. Must be unique — another account cannot already use this number.
        </p>
      </div>

      <hr className="form-divider" />
      <div className="eyebrow">Your location</div>
      <p className="field-hint" style={{ marginTop: 4, marginBottom: 10 }}>
        We use this to surface campaigns near you. It stays private to your account.
      </p>

      <div className="segmented" style={{ marginBottom: 12 }}>
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={method === m.id ? "active" : ""}
            onClick={() => setMethod(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {method === "address" ? (
        <div className="form-field">
          <label className="field-label">Full address</label>
          <input
            className="field"
            value={address}
            placeholder="123 Main St, Shoreline, WA 98155"
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
      ) : null}

      {method === "city" ? (
        <div className="form-two">
          <div className="form-field">
            <label className="field-label">City</label>
            <input className="field" value={city} placeholder="Shoreline" onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="form-field">
            <label className="field-label">State</label>
            <input className="field" value={stateCode} onChange={(e) => setStateCode(e.target.value)} />
          </div>
        </div>
      ) : null}

      {method === "zip" ? (
        <div className="form-field">
          <label className="field-label">ZIP code</label>
          <input className="field" value={zip} placeholder="98155" onChange={(e) => setZip(e.target.value)} />
        </div>
      ) : null}

      {method === "gps" ? (
        <p className="field-hint" style={{ marginBottom: 10 }}>
          Share your device location once and we&apos;ll remember it.
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn-outline btn-block btn-sm"
        disabled={locating}
        onClick={findLocation}
      >
        {locating ? "Locating…" : method === "gps" ? "Use my current location" : "Find location"}
      </button>

      {resolved ? (
        <div style={{ marginTop: 12 }}>
          <Map
            home={{ lat: resolved.lat, lng: resolved.lng }}
            caption={resolved.label}
          />
        </div>
      ) : null}

      <div className="form-actions" style={{ marginTop: 16 }}>
        <button className="btn btn-primary btn-block" disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>

      <hr className="form-divider" />
      <button
        type="button"
        className="btn btn-ghost btn-block"
        onClick={() => {
          if (window.confirm("Sign out of StrideVote?")) void doSignOut();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
