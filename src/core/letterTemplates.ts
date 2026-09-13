/**
 * Official correspondence for the outreach.
 *
 * An outreach of this kind cannot happen without letters. The traditional
 * ruler has to give his blessing before anyone will attend; the Local
 * Government must know it is happening; the Ministry of Health expects
 * notification and, afterwards, a report; the school whose classrooms become
 * consulting rooms needs to be asked; the police should be told a crowd is
 * expected. Each of those is a letter written to a particular person, in a
 * particular register, and getting the register wrong is not a small thing.
 *
 * WHY THESE ARE DRAFTS AND NOT FORM LETTERS
 * -----------------------------------------
 * Every template here is a starting point that the person sending it is
 * expected to read and change. The salutations are the courteous ones used
 * in south-eastern Nigeria - "Your Royal Highness" to a traditional ruler,
 * "Honourable Commissioner" to a member of the State Executive Council - and
 * the placeholders are the facts the application already knows. Nothing is
 * sent from here; a letter is printed or saved as a PDF and delivered by a
 * person, which is how these things are properly done.
 *
 * Placeholders are written {{like_this}} and filled from the project and the
 * fields the writer completes. Anything left unfilled is shown plainly in the
 * draft rather than silently blanked, so nobody sends a letter addressed to
 * "Dear ,".
 */

export type LetterCategory = 'PERMISSION' | 'NOTIFICATION' | 'INVITATION' | 'REQUEST' | 'GRATITUDE'

export interface LetterTemplate {
  key: string
  /** What the letter is for, in the writer's words. */
  name: string
  category: LetterCategory
  /** Who it is written to, to help the writer choose. */
  audience: string
  /** When to send it, relative to the outreach day. */
  timing: string
  /** Filled into the recipient block as a starting point. */
  suggestedTitle?: string
  suggestedSalutation: string
  subject: string
  /** Paragraphs. Blank strings are not permitted; omit instead. */
  body: string[]
  /** The complimentary close, which differs by how formal the letter is. */
  closing: string
  /** Suggested enclosures, which the writer edits. */
  enclosures?: string[]
  /** Who else should receive a copy. */
  copies?: string[]
}

export const LETTER_TEMPLATES: LetterTemplate[] = [
  // ------------------------------------------------------- permission
  {
    key: 'TRADITIONAL_RULER',
    name: 'Seeking the blessing of the traditional ruler',
    category: 'PERMISSION',
    audience: 'The Igwe, Eze or Obi of the community',
    timing: 'Six to eight weeks before — this letter comes before all others',
    suggestedTitle: 'The Traditional Ruler',
    suggestedSalutation: 'Your Royal Highness',
    subject:
      'Request for Royal Approval and Blessing for a Free Community Health Outreach at {{location}}',
    body: [
      'I write with the deepest respect to seek Your Royal Highness’s approval and blessing for a free community health outreach which we humbly propose to hold at {{location}}, {{lga}} Local Government Area, on {{date}}.',
      'The outreach is organised in loving memory of {{honouree}}, and is offered at no cost whatsoever to the people of the community. We expect to receive approximately {{expected}} men, women and children.',
      'The following services will be provided free of charge: blood pressure screening, blood sugar testing, clinical breast examination, wound care and dressing, general health consultation and counselling. Those found to need care beyond what we can offer on the day will be referred to a hospital, and we will follow them up afterwards.',
      'We come not to disturb the peace of the community but to serve it, and we are conscious that nothing of this nature should take place without Your Royal Highness’s knowledge and consent. We would be most grateful for your approval, and for any guidance you may wish to give us on how best to conduct ourselves among your people.',
      'We would also be honoured if Your Royal Highness, or a representative of the palace, would declare the outreach open on the day.',
      'Please accept, Your Royal Highness, the assurances of our highest regard.',
    ],
    closing: 'Yours most respectfully,',
    copies: ['The Secretary, {{location}} Community Development Union'],
  },
  {
    key: 'COMMUNITY_LEADERS',
    name: 'Asking the town union and elders to support it',
    category: 'PERMISSION',
    audience: 'President-General of the town union, village heads, elders',
    timing: 'Six weeks before, after the palace has agreed',
    suggestedTitle: 'The President-General',
    suggestedSalutation: 'Dear Sir',
    subject: 'Free Community Health Outreach at {{location}} on {{date}} — Request for Support',
    body: [
      'Following the kind approval of the palace, we write to inform the Union of a free community health outreach to be held at {{location}} on {{date}}, from {{start_time}} to {{end_time}}.',
      'The outreach is held in memory of {{honouree}}. All services are free. We expect about {{expected}} people and have made arrangements for orderly registration so that nobody is turned away without being seen.',
      'We respectfully request the Union’s assistance in three matters: announcing the outreach at the town meeting and in the churches on the preceding Sundays; helping us identify the elderly and the infirm who may need to be brought to the venue; and providing a few volunteers to help with crowd control and direction on the day.',
      'We are available to attend a meeting of the Union at your convenience to explain the arrangements in full.',
    ],
    closing: 'Yours faithfully,',
    copies: ['The Traditional Ruler', 'The Village Heads'],
  },
  {
    key: 'VENUE_REQUEST',
    name: 'Requesting the use of a venue',
    category: 'REQUEST',
    audience: 'Head teacher, parish priest, or whoever holds the hall',
    timing: 'Six weeks before',
    suggestedTitle: 'The Head Teacher',
    suggestedSalutation: 'Dear Sir/Madam',
    subject: 'Request for the Use of Your Premises on {{date}} for a Free Health Outreach',
    body: [
      'We write to request the use of your premises at {{location}} on {{date}}, between {{start_time}} and {{end_time}}, for a free community health outreach held in memory of {{honouree}}.',
      'We would require the use of an open space for registration and waiting, and a number of rooms which can be screened for private consultation and examination. Approximately {{expected}} people are expected.',
      'We undertake to leave the premises exactly as we met them, to provide our own tables, chairs and equipment where possible, to clean the premises at the close of the day, and to bear the cost of repairing any damage occasioned by our use.',
      'We would be grateful for your kind approval, and are happy to inspect the premises with you beforehand to agree on the arrangements.',
    ],
    closing: 'Yours faithfully,',
    enclosures: ['Programme of the day', 'List of services to be offered'],
  },

  // ---------------------------------------------------- notification
  {
    key: 'COMMISSIONER_HEALTH',
    name: 'Notifying the State Commissioner for Health',
    category: 'NOTIFICATION',
    audience: 'Honourable Commissioner for Health, {{state}} State',
    timing: 'Six weeks before',
    suggestedTitle: 'The Honourable Commissioner for Health',
    suggestedSalutation: 'Honourable Commissioner',
    subject:
      'Notification of a Free Community Health Outreach at {{location}}, {{lga}} LGA, on {{date}}',
    body: [
      'I have the honour to notify the Ministry of a free community health outreach to be held at {{location}} in {{lga}} Local Government Area on {{date}}, organised in memory of {{honouree}}.',
      'The outreach will offer screening for raised blood pressure and raised blood sugar, clinical breast examination, wound care, and general health consultation and counselling, entirely free of charge. We anticipate attending to approximately {{expected}} residents.',
      'The clinical team is led by {{medical_director}} and comprises qualified doctors, nurses, pharmacists and laboratory personnel, each practising within their scope. We wish to state clearly that the outreach performs screening and clinical assessment; it does not purport to establish diagnoses that properly require investigation, and every participant whose findings warrant further care will be referred formally to a hospital and followed up thereafter.',
      'Records are kept securely and confidentially on encrypted devices, and a consolidated report of the outreach will be submitted to the Ministry within four weeks of the event.',
      'We would be honoured by the Ministry’s recognition of this effort, and would welcome any guidance, supervision or participation the Ministry may consider appropriate.',
      'Please accept, Honourable Commissioner, the assurances of our highest consideration.',
    ],
    closing: 'Yours faithfully,',
    enclosures: [
      'Programme of the outreach',
      'List of services and clinical protocols',
      'Composition of the clinical team',
    ],
    copies: [
      'The Permanent Secretary, Ministry of Health, {{state}} State',
      'The Director of Public Health, {{state}} State',
    ],
  },
  {
    key: 'LGA_CHAIRMAN',
    name: 'Informing the Local Government Chairman',
    category: 'NOTIFICATION',
    audience: 'Executive Chairman, {{lga}} Local Government Area',
    timing: 'Six weeks before',
    suggestedTitle: 'The Executive Chairman',
    suggestedSalutation: 'Your Excellency',
    subject: 'Free Community Health Outreach at {{location}} on {{date}}',
    body: [
      'We write to inform the Local Government of a free community health outreach to be held at {{location}} on {{date}}, in memory of {{honouree}}.',
      'All services are provided free of charge to residents of {{lga}} Local Government Area. We expect approximately {{expected}} attendees. The full programme and list of services are enclosed.',
      'We would be grateful for the Local Government’s support, particularly in the areas of publicity through the ward councillors, and the provision of environmental and security support on the day.',
      'The Chairman, or a representative, would be most welcome at the opening of the outreach.',
    ],
    closing: 'Yours faithfully,',
    enclosures: ['Programme of the outreach', 'List of services'],
    copies: ['The Medical Officer of Health, {{lga}} LGA', 'The Councillor representing the ward'],
  },
  {
    key: 'MOH_LGA',
    name: 'Notifying the Medical Officer of Health',
    category: 'NOTIFICATION',
    audience: 'Medical Officer of Health / Primary Health Care Coordinator',
    timing: 'Four weeks before',
    suggestedTitle: 'The Medical Officer of Health',
    suggestedSalutation: 'Dear Sir/Madam',
    subject: 'Notification of a Free Health Outreach at {{location}} on {{date}}',
    body: [
      'We write to notify your office of a free community health outreach at {{location}} on {{date}}, and to seek your professional cooperation.',
      'Services will include blood pressure and blood glucose screening, clinical breast examination, wound care and health counselling. Participants requiring further care will be referred, and we would be glad to agree with you in advance the facilities to which referrals should properly be directed.',
      'We would welcome the participation of staff of the primary health centre, both to strengthen the outreach and to ensure continuity of care for those we refer.',
      'We will provide your office with anonymised figures from the outreach for inclusion in the Local Government’s health records.',
    ],
    closing: 'Yours faithfully,',
  },
  {
    key: 'POLICE',
    name: 'Informing the police of the gathering',
    category: 'NOTIFICATION',
    audience: 'Divisional Police Officer',
    timing: 'Two to three weeks before',
    suggestedTitle: 'The Divisional Police Officer',
    suggestedSalutation: 'Dear Sir',
    subject: 'Notification of a Public Health Gathering at {{location}} on {{date}}',
    body: [
      'We write to inform your Division of a free community health outreach to be held at {{location}} on {{date}}, between {{start_time}} and {{end_time}}.',
      'The gathering is entirely medical and charitable in nature. We anticipate approximately {{expected}} persons attending over the course of the day, arriving and departing in an orderly manner.',
      'We would be grateful for the presence of officers at the venue to assist with crowd control and general safety, and we are willing to meet any approved cost of such deployment.',
      'The traditional ruler, the town union and the Local Government have been informed and have given their support.',
    ],
    closing: 'Yours faithfully,',
  },

  // ------------------------------------------------------ invitation
  {
    key: 'REFERRAL_HOSPITAL',
    name: 'Arranging a receiving hospital for referrals',
    category: 'REQUEST',
    audience: 'Medical Director of the hospital that will receive referrals',
    timing: 'Four weeks before — settle this before the outreach, not during it',
    suggestedTitle: 'The Medical Director',
    suggestedSalutation: 'Dear Sir/Madam',
    subject: 'Request for a Referral Pathway for a Free Health Outreach on {{date}}',
    body: [
      'We write to request your hospital’s cooperation in receiving patients referred from a free community health outreach at {{location}} on {{date}}.',
      'Screening of this kind reliably identifies people who need care that cannot be given in a field setting: severely raised blood pressure, very high blood sugar, breast lumps requiring proper assessment, and wounds requiring surgical attention. It would be of little value, and arguably wrong, to identify such people and have nowhere to send them.',
      'We therefore ask whether your hospital would be willing to receive our referrals, and if so, whom we should name on the referral letter, and whether any concession on consultation fees might be extended to those referred, many of whom are of very limited means.',
      'Each person referred will carry a written referral stating the findings and the reason for referral. We follow up every referral afterwards and would be glad to share the outcome with you.',
    ],
    closing: 'Yours faithfully,',
    enclosures: ['Specimen referral form', 'Clinical thresholds used for referral'],
  },
  {
    key: 'PARTNER_INVITATION',
    name: 'Inviting a professional body or partner organisation',
    category: 'INVITATION',
    audience: 'Medical association, nursing association, NGO, church health board',
    timing: 'Six weeks before',
    suggestedTitle: 'The Chairman',
    suggestedSalutation: 'Dear Sir/Madam',
    subject: 'Invitation to Partner in a Free Community Health Outreach on {{date}}',
    body: [
      'We write to invite your organisation to partner with us in a free community health outreach at {{location}} on {{date}}, held in memory of {{honouree}}.',
      'We expect approximately {{expected}} residents, many of whom have not seen a health worker in years. Partnership might take the form of volunteer clinical personnel, consumables and medicines, or assistance with publicity within the community.',
      'Your organisation would be acknowledged in the programme and in the report of the outreach.',
      'We would be glad to meet your representatives to discuss how best your organisation might contribute.',
    ],
    closing: 'Yours faithfully,',
    enclosures: ['Programme of the outreach', 'Budget summary'],
  },
  {
    key: 'SPONSORSHIP',
    name: 'Requesting sponsorship or donation',
    category: 'REQUEST',
    audience: 'Companies, philanthropists, sons and daughters of the community abroad',
    timing: 'Eight to ten weeks before — funds must be in hand early',
    suggestedTitle: 'The Managing Director',
    suggestedSalutation: 'Dear Sir/Madam',
    subject: 'Appeal for Support towards a Free Community Health Outreach on {{date}}',
    body: [
      'We write to appeal for your support towards a free community health outreach to be held at {{location}} on {{date}}, in memory of {{honouree}}.',
      'The outreach will provide free screening for high blood pressure and diabetes, clinical breast examination, wound care and health counselling to approximately {{expected}} men, women and children, most of whom cannot afford even the cost of transport to a hospital.',
      'Support may take the form of a cash donation towards medicines and consumables, the donation of materials directly, or the sponsorship of a particular station for the day. A summary of our budget is enclosed, and we will render a full account of all funds received.',
      'Every naira given goes to the care of people who would otherwise go unseen. We would be honoured to count your organisation among those who made it possible.',
    ],
    closing: 'Yours faithfully,',
    enclosures: ['Budget summary', 'Programme of the outreach'],
  },
  {
    key: 'MEDIA',
    name: 'Inviting the press',
    category: 'INVITATION',
    audience: 'Newspaper, radio station, state television',
    timing: 'One to two weeks before',
    suggestedTitle: 'The News Editor',
    suggestedSalutation: 'Dear Sir/Madam',
    subject: 'Press Invitation — Free Community Health Outreach at {{location}} on {{date}}',
    body: [
      'You are invited to cover a free community health outreach at {{location}}, {{lga}} Local Government Area, on {{date}}, beginning at {{start_time}}.',
      'The outreach is held in memory of {{honouree}} and will provide free screening and treatment to approximately {{expected}} residents.',
      'We ask that coverage respect the privacy of those attending: no participant may be photographed, filmed or interviewed without their own express permission, and no images may be taken inside the consultation areas under any circumstances. Our team will gladly arrange interviews and suitable photographs.',
      '{{project_director}} will be available to speak to the press on the day.',
    ],
    closing: 'Yours faithfully,',
  },

  // ------------------------------------------------------- gratitude
  {
    key: 'THANKS_GENERAL',
    name: 'Thanking those who helped, afterwards',
    category: 'GRATITUDE',
    audience: 'Anyone who supported the outreach',
    timing: 'Within two weeks of the outreach — do not let this slip',
    suggestedSalutation: 'Dear Sir/Madam',
    subject: 'Appreciation for Your Support of the Health Outreach of {{date}}',
    body: [
      'On behalf of the organisers of the free community health outreach held at {{location}} on {{date}}, I write to thank you most sincerely for your support.',
      'Through the generosity of people such as yourself, we were able to attend to the residents of the community without charge, to identify a number of persons in need of urgent medical attention, and to refer them for care which many would not otherwise have sought.',
      'A report of the outreach is enclosed. We hope it conveys something of what your support made possible.',
      'We look forward to your continued partnership in the service of this community.',
    ],
    closing: 'Yours faithfully,',
    enclosures: ['Report of the outreach'],
  },
  {
    key: 'REPORT_SUBMISSION',
    name: 'Submitting the report to the Ministry',
    category: 'NOTIFICATION',
    audience: 'Commissioner for Health, Medical Officer of Health',
    timing: 'Within four weeks of the outreach',
    suggestedTitle: 'The Honourable Commissioner for Health',
    suggestedSalutation: 'Honourable Commissioner',
    subject: 'Submission of the Report of the Free Health Outreach held on {{date}}',
    body: [
      'Further to our earlier notification, I have the honour to submit herewith the report of the free community health outreach held at {{location}}, {{lga}} Local Government Area, on {{date}}.',
      'The report sets out the number of persons attended to, the screening findings in aggregate, the referrals made and their outcomes, and the principal health needs observed in the community. No individual is identified in it.',
      'We hope the findings are of use to the Ministry in its planning for the area, and we remain available to provide any further information the Ministry may require.',
      'Please accept, Honourable Commissioner, the assurances of our highest consideration.',
    ],
    closing: 'Yours faithfully,',
    enclosures: ['Report of the outreach'],
    copies: ['The Medical Officer of Health, {{lga}} LGA'],
  },
]

export const CATEGORY_LABELS: Record<LetterCategory, string> = {
  PERMISSION: 'Permission and blessing',
  NOTIFICATION: 'Official notification',
  INVITATION: 'Invitation',
  REQUEST: 'Request',
  GRATITUDE: 'Thanks afterwards',
}

/** Salutations offered in the editor, in descending order of formality. */
export const SALUTATIONS = [
  'Your Royal Highness',
  'Your Excellency',
  'Honourable Commissioner',
  'Dear Sir',
  'Dear Madam',
  'Dear Sir/Madam',
  'Dear Doctor',
  'Distinguished Sir',
]

export const CLOSINGS = [
  'Yours faithfully,',
  'Yours sincerely,',
  'Yours most respectfully,',
  'Respectfully yours,',
]

export interface Placeholders {
  location: string
  lga: string
  state: string
  date: string
  start_time: string
  end_time: string
  expected: string
  honouree: string
  project_director: string
  medical_director: string
  project_name: string
}

/**
 * Fills {{placeholders}}.
 *
 * A value that is not known is left as a visible marker rather than being
 * replaced with nothing. A letter to a Commissioner that reads "on  in  Local
 * Government Area" is worse than one that plainly shows what still needs
 * filling in, because the first kind gets sent.
 */
export function fillPlaceholders(text: string, values: Partial<Placeholders>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = (values as Record<string, string | undefined>)[key]
    return value && value.trim() ? value.trim() : `[${key.replace(/_/g, ' ')}]`
  })
}

/** Anything still unfilled, so the writer can be warned before sending. */
export function missingPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\[([a-z ]+)\]/g)].map((m) => m[1]))]
}
