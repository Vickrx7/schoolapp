/**
 * The PDF's interface words from the message files (the reader's language; the plan itself stays
 * in the teacher's French). Most are the web view's own labels (`subPlan.*`), so screen and
 * paper say the same thing; `pdf.*` holds what only paper needs. Not server-only, so the model
 * and the renderer can be unit tested with real messages.
 */
import { createTranslator } from 'next-intl';
import type messages from '../../../messages/fr-CA.json';
import type { AppLocale } from '../../i18n/config';
import type { PlanPdfLabels } from './model';

export function planPdfLabels(locale: AppLocale, catalog: typeof messages): PlanPdfLabels {
  const t = createTranslator({ locale, messages: catalog });
  return {
    locale,
    title: t('subPlan.title'),
    documentTitle: (date) => t('pdf.documentTitle', { date }),
    confidential: t('pdf.confidential'),
    page: (page, total) => t('pdf.page', { page, total }),
    alertsElsewhere: t('pdf.alertsElsewhere'),
    failed: t('pdf.failed'),
    failedBack: t('pdf.failedBack'),
    classOf: (name) => t('subPlan.classOf', { name }),
    dayOfCycle: (n) => t('subPlan.dayOfCycle', { n }),
    part: {
      full_day: t('absences.part.full_day'),
      am: t('absences.part.am'),
      pm: t('absences.part.pm'),
    },
    status: {
      shortened: t('today.status.shortened'),
      replaced: t('today.status.replaced'),
      interrupted: t('today.status.interrupted'),
    },
    role: {
      homeroom: t('classes.role.homeroom'),
      subject: t('classes.role.subject'),
      support: t('classes.role.support'),
    },
    overview: t('subPlan.overview'),
    absenceNote: t('subPlan.contacts.absenceNote'),
    sections: {
      schedule: t('subPlan.sections.schedule'),
      events: t('subPlan.sections.events'),
      groups: t('subPlan.sections.groups'),
      classNotes: t('subPlan.sections.classNotes'),
      contacts: t('subPlan.sections.contacts'),
      endOfDay: t('subPlan.sections.endOfDay'),
      faith: t('subPlan.sections.faith'),
    },
    block: {
      steps: t('subPlan.block.steps'),
      say: t('subPlan.block.say'),
      ifTime: t('subPlan.block.ifTime'),
      materials: t('subPlan.block.materials'),
      objectives: t('subPlan.block.objectives'),
      content: t('subPlan.block.content'),
      subNotes: t('subPlan.block.subNotes'),
      notes: t('subPlan.block.notes'),
      teacherNote: t('subPlan.block.teacherNote'),
      taught: t('subPlan.block.taught'),
      lesson: (n, unit) => t('subPlan.block.lesson', { n, unit }),
      gap: (title) => t('subPlan.block.gap', { title }),
      otherAdult: (name) => t('subPlan.block.otherAdult', { name }),
      minutes: (n) => t('subPlan.block.minutes', { n }),
    },
    ai: {
      overview: t('subPlanAi.block.overview'),
      differentiation: t('subPlanAi.block.differentiation'),
      activity: t('subPlanAi.block.activity'),
    },
    classNotes: {
      arrival: t('subPlan.classNotes.arrival'),
      routines: t('subPlan.classNotes.routines'),
      dismissal: t('subPlan.classNotes.dismissal'),
      fallbackActivities: t('subPlan.classNotes.fallbackActivities'),
    },
    contacts: {
      office: t('subPlan.contacts.office'),
      neighbour: t('subPlan.contacts.neighbour'),
      arrival: t('subPlan.contacts.arrival'),
      emergency: t('subPlan.contacts.emergency'),
    },
    groups: {
      noLevel: t('subPlan.groups.noLevel'),
      hint: t('subPlan.groups.hint'),
      count: (count) => t('subPlan.groups.count', { count }),
    },
    endOfDayAt: (time) => t('subPlan.endOfDayAt', { time }),
  };
}
