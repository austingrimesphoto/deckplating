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
  organizationId?: string | null;
  areas: Area[];
  teamMembers: TeamMember[];
  units: UnitSummary[];
  mapTileUrl: string;
  mapDefaultLatitude: number;
  mapDefaultLongitude: number;
  installationName: string;
  gamificationTone: GamificationTone;
};

export type Identity = {
  organizationId?: string | null;
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
  gray_to_green_units: number;
  coverage_sweep_areas: number;
  active_days: number;
  score: number;
  badges: MissionBadge[];
};

export type GamificationTone = 'professional' | 'friendly' | 'banter';

export type MissionBadge =
  | 'first_rounds'
  | 'recovery_team'
  | 'gray_to_green'
  | 'wide_coverage'
  | 'sustained_presence'
  | 'coverage_sweep';

export type MissionBoardSummary = {
  units_recovered_this_month: number;
  distinct_units_covered: number;
  overdue_remaining: number;
  never_visited_remaining: number;
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
  batch_id: string | null;
  client_batch_id: string | null;
  confidential_care_provided: true | null;
  referral_provided: true | null;
};

export type CoverageCheckin = {
  id: string;
  checked_in_at: string;
  team_member_name: string;
  geofence_verified: boolean;
  score_awarded: number;
  voided_at: string | null;
  void_reason: string | null;
  confidential_care_provided: true | null;
  referral_provided: true | null;
};

export type CoverageDetail = {
  unit: UnitSummary;
  checkins: CoverageCheckin[];
};

export type IndicatorReportRow = {
  key: string;
  area_id: string | null;
  area_name: string;
  location_id: string | null;
  location_name: string;
  visits: number;
  confidential_care_count: number;
  referral_count: number;
  single_unit_indicator_visits: number;
  multi_unit_indicator_visits: number;
};

export type VisitIndicatorState = {
  confidentialCareProvided: true | null;
  referralProvided: true | null;
};

export type PendingVisitBatch = VisitIndicatorState & {
  clientBatchId: string;
  organizationId?: string | null;
  teamMemberId: string;
  teamMemberName: string;
  deviceToken: string;
  unitIds: string[];
  unitNames: string[];
  locationId: string | null;
  locationName: string | null;
  latitude?: number;
  longitude?: number;
  manual: boolean;
  occurredAt: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'failed' | 'auth';
  serverBatchId?: string;
  checkinIds?: string[];
  totalScore?: number;
  lastSyncError?: string | null;
  createdAt: string;
  updatedAt: string;
};
