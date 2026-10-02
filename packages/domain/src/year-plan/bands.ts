/**
 * The liturgical seasons over a school year (« Temps liturgique », DECISIONS D-126): Advent,
 * Christmas, Lent and Easter as `liturgicalSeasonOn` computes them (D-058). Ordinary Time is
 * left out.
 */
import { addDays, type LocalDate } from '../dates';
import { liturgicalSeasonOn, type LiturgicalSeason } from '../sub-plan/catholic';

export type LiturgicalBandSeason = Exclude<LiturgicalSeason, 'temps_ordinaire'>;

export interface LiturgicalBand {
  season: LiturgicalBandSeason;
  from: LocalDate;
  to: LocalDate;
}

/** The contiguous seasons between two dates (inclusive), Ordinary Time left out. */
export function liturgicalBands(startsOn: LocalDate, endsOn: LocalDate): LiturgicalBand[] {
  const bands: LiturgicalBand[] = [];
  for (let date = startsOn; date <= endsOn; date = addDays(date, 1)) {
    const season = liturgicalSeasonOn(date);
    const last = bands[bands.length - 1];
    if (season === 'temps_ordinaire') continue;
    if (last && last.season === season && addDays(last.to, 1) === date) last.to = date;
    else bands.push({ season, from: date, to: date });
  }
  return bands;
}
