export type SalesStatus = "not_open" | "open" | "few" | "sold_out" | "ended";

export type SalesAudience = "public" | "member";

export type SalesWindow = {
  startsAt?: string;
  endsAt?: string;
};

export type SalesWindows = {
  public: SalesWindow;
  member?: SalesWindow;
};

export type Screening = {
  performanceId: string;
  movieCode: string;
  movieTitle: string;
  theaterCode: string;
  screenName: string;
  formatLabels: string[];
  startsAt: string;
  endsAt?: string;
  salesStatus: SalesStatus;
  salesWindows: SalesWindows;
  purchaseUrl?: string;
};

export type ScreeningFilter = {
  targetDate?: string;
  titleIncludes?: string;
  titlePattern?: string;
  formatIncludes?: readonly string[];
  formatExcludes?: readonly string[];
  startTimeFrom?: string;
  startTimeTo?: string;
};

function compileTitlePattern(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid titlePattern "${pattern}": ${reason}`);
  }
}

export function startsAtDate(startsAt: string): string {
  return startsAt.slice(0, 10);
}

export function startsAtTime(startsAt: string): string {
  return startsAt.slice(11, 16);
}

export function formatHaystack(screening: Screening): string {
  return [screening.movieTitle, screening.screenName, ...screening.formatLabels]
    .join("\n")
    .toLowerCase();
}

export function filterScreenings(
  screenings: readonly Screening[],
  filter: ScreeningFilter = {},
): Screening[] {
  const titlePattern =
    filter.titlePattern !== undefined ? compileTitlePattern(filter.titlePattern) : undefined;
  const titleIncludes = filter.titleIncludes?.trim().toLowerCase() ?? "";

  return screenings.filter((screening) => {
    if (filter.targetDate !== undefined && startsAtDate(screening.startsAt) !== filter.targetDate) {
      return false;
    }
    if (titleIncludes !== "" && !screening.movieTitle.toLowerCase().includes(titleIncludes)) {
      return false;
    }
    if (titlePattern !== undefined && !titlePattern.test(screening.movieTitle)) {
      return false;
    }

    const haystack = formatHaystack(screening);
    if (filter.formatIncludes?.some((term) => !haystack.includes(term.toLowerCase()))) {
      return false;
    }
    if (filter.formatExcludes?.some((term) => haystack.includes(term.toLowerCase()))) {
      return false;
    }

    const time = startsAtTime(screening.startsAt);
    if (filter.startTimeFrom !== undefined && time < filter.startTimeFrom) {
      return false;
    }
    if (filter.startTimeTo !== undefined && time > filter.startTimeTo) {
      return false;
    }
    return true;
  });
}

export function sortScreeningsByStart(screenings: readonly Screening[]): Screening[] {
  return [...screenings].sort((a, b) => {
    if (a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
    return a.performanceId < b.performanceId ? -1 : a.performanceId > b.performanceId ? 1 : 0;
  });
}
