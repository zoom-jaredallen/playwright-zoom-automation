import type { AddressProfileView } from "../api.js";

interface AddressProfilePanelProps {
  profiles: AddressProfileView[];
  selectedProfileId: string;
  onChange(profileId: string): void;
}

export function AddressProfilePanel({ profiles, selectedProfileId, onChange }: AddressProfilePanelProps) {
  const profile = profiles.find((item) => item.id === selectedProfileId);

  return (
    <section className="panel" id="settings">
      <div className="panel-header compact">
        <div>
          <h2>Address profile</h2>
          <p>Resolve the country, number type, documents, and customer details from YAML.</p>
        </div>
      </div>
      <label className="field">
        <span>Profile</span>
        <select value={selectedProfileId} onChange={(event) => onChange(event.target.value)}>
          {profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.id}
            </option>
          ))}
        </select>
      </label>

      {profile ? (
        <dl className="profile-summary">
          <div>
            <dt>Country</dt>
            <dd>{profile.country}</dd>
          </div>
          <div>
            <dt>Number type</dt>
            <dd>{profile.numberType}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{profile.customerName}</dd>
          </div>
          <div className="wide">
            <dt>Address</dt>
            <dd>
              {[profile.address.line1, profile.address.line2, profile.address.city, profile.address.state, profile.address.postalCode]
                .filter(Boolean)
                .join(", ")}
            </dd>
          </div>
          <div>
            <dt>Documents</dt>
            <dd>{profile.documentsRequired ? "Required" : "Not required"}</dd>
          </div>
        </dl>
      ) : (
        <div className="banner warning">Select an address profile before starting a run.</div>
      )}
    </section>
  );
}
