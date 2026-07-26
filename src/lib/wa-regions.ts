import waSldu from "@/data/wa-sldu.json";
import waCd from "@/data/wa-cd.json";

export interface RegionOption {
  value: string;
  label: string;
}

/** All 39 Washington counties (alphabetical). */
export const WA_COUNTIES: RegionOption[] = [
  "Adams", "Asotin", "Benton", "Chelan", "Clallam", "Clark", "Columbia",
  "Cowlitz", "Douglas", "Ferry", "Franklin", "Garfield", "Grant", "Grays Harbor",
  "Island", "Jefferson", "King", "Kitsap", "Kittitas", "Klickitat", "Lewis",
  "Lincoln", "Mason", "Okanogan", "Pacific", "Pend Oreille", "Pierce", "San Juan",
  "Skagit", "Skamania", "Snohomish", "Spokane", "Stevens", "Thurston", "Wahkiakum",
  "Walla Walla", "Whatcom", "Whitman", "Yakima",
].map((name) => ({ value: name, label: `${name} County` }));

type FeatureProps = { SLDU?: string; CD119?: string; BASENAME?: string; NAME?: string };

function fromFeatures(
  features: Array<{ properties: FeatureProps }>,
  codeField: "SLDU" | "CD119",
  labelFor: (n: number, name: string) => string,
): RegionOption[] {
  return features
    .map((f) => {
      const n = Number(f.properties[codeField] ?? f.properties.BASENAME);
      return {
        value: String(n),
        label: labelFor(n, String(f.properties.NAME ?? n)),
      };
    })
    .filter((o) => Number.isFinite(Number(o.value)))
    .sort((a, b) => Number(a.value) - Number(b.value));
}

export const WA_LEGISLATIVE_DISTRICTS: RegionOption[] = fromFeatures(
  (waSldu as { features: Array<{ properties: FeatureProps }> }).features,
  "SLDU",
  (n) => `LD ${n}`,
);

export const WA_CONGRESSIONAL_DISTRICTS: RegionOption[] = fromFeatures(
  (waCd as { features: Array<{ properties: FeatureProps }> }).features,
  "CD119",
  (n) => `CD ${n}`,
);

/** Dropdown options for a WA region type, or null if free-text is better. */
export function waRegionOptions(
  regionType: string,
): RegionOption[] | null {
  switch (regionType) {
    case "county":
      return WA_COUNTIES;
    case "legislative":
      return WA_LEGISLATIVE_DISTRICTS;
    case "congressional":
      return WA_CONGRESSIONAL_DISTRICTS;
    default:
      return null;
  }
}
