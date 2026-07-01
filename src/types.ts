export type Area = {
  id: string;
  name: string;
  sort_order: number;
};

export type TeamMember = {
  id: string;
  name: string;
  role: string | null;
};

export type UnitType = 'department' | 'division' | 'tenant';

export type CoverageStatus = 'green' | 'yellow' | 'red' | 'gray';

export type UnitSummary = {
  id: string;
  name: string;
  unit_type: UnitType;
  visit_interval_days: number;
  active: boolean;
  location_id: string | null;
  location_name: string | null;
  area_id: string | null;
  area_name: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
  last_visit_at: string | null;
  last_visitor: string | null;
  days_since_last_visit: number | null;
  status: CoverageStatus;
};

export type LocationSummary = {
  id: string;
  area_id: string;
  area_name: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  distance_meters?: number;
  status: CoverageStatus;
  units: UnitSummary[];
};

export type Bootstrap = {
  areas: Area[];
  teamMembers: TeamMember[];
  units: UnitSummary[];
  mapTileUrl: string;
  mapDefaultLatitude: number;
  mapDefaultLongitude: number;
  installationName: string;
};

export type Identity = {
  teamMemberId: string;
  teamMemberName: string;
  deviceToken: string;
  deviceId: string;
  sessionToken: string;
};

export type LeaderboardRow = {
  team_member_id: string;
  name: string;
  qualifying_checkins: number;
  distinct_units: number;
  recovered_units: number;
  score: number;
};

export type AdminCheckin = {
  id: string;
  unit_id: string;
  unit_name: string;
  location_id: string | null;
  location_name: string;
  area_id: string | null;
  area_name: string | null;
  team_member_id: string;
  team_member_name: string;
  checked_in_at: string;
  geofence_verified: boolean;
  score_awarded: number;
  voided_at: string | null;
  void_reason: string | null;
  updated_at: string | null;
};
