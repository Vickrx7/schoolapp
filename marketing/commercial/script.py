"""The commercial's script: one entry per scene, in English and French.

`say` is what the voice reads; `cap` is the burned-in caption ("|" starts a new caption page,
"\\n" a new line). Every claim follows marketing/README.md (on the PR #2 branch): what the pilot
build does today, « conçue pour être hébergée au Canada », no AI output or AI quality claim, two
taps for an absence, report card comments never leave the browser, « Info-parents » sends nothing.
"""
from __future__ import annotations

import re

APP = "Lynx École"  # working name (APP_NAME in the app)

CHAPTERS = {
    1: ("Your day", "Votre journée"),
    2: ("Your planning", "Votre planification"),
    3: ("Resources", "Ressources"),
    4: ("In class", "En classe"),
    5: ("A sick day", "Une journée de suppléance"),
    6: ("Report cards and families", "Bulletins et familles"),
    7: ("Principals", "La direction"),
    8: ("School boards", "Le conseil scolaire"),
    9: ("Privacy first", "La confidentialité d'abord"),
    10: ("Getting started", "Pour commencer"),
}

# id, chapter (0 = none), English, French
LINES = [
    dict(id="papers", ch=0,
         en=dict(say="Lesson plans. Sub plans. Report cards. The note home on Friday. A teacher's year runs on a thousand pieces of paper.",
                 cap="Lesson plans. Sub plans. Report cards. The note home on Friday.\nA teacher's year runs on a thousand pieces of paper."),
         fr=dict(say="Planifications, plans de suppléance, bulletins, le message du vendredi aux familles. Toute une année scolaire tient sur mille bouts de papier.",
                 cap="Planifications, plans de suppléance, bulletins, le message du vendredi…\nToute une année scolaire tient sur mille bouts de papier.")),
    dict(id="title", ch=0,
         en=dict(say=f"{APP} puts it all in one place. It's made for Ontario's French-language Catholic elementary schools.",
                 cap=f"{APP} puts it all in one place.\nMade for Ontario's French-language Catholic elementary schools."),
         fr=dict(say=f"{APP} réunit tout au même endroit. Elle est pensée pour les écoles élémentaires catholiques de langue française de l'Ontario.",
                 cap=f"{APP} réunit tout au même endroit.\nPensée pour les écoles élémentaires catholiques de langue française de l'Ontario.")),

    # 1 · Your day
    dict(id="today", ch=1,
         en=dict(say="Your day starts on Today: every period and every routine, from morning prayer and O Canada to the next lesson in each subject, straight from your own planning.",
                 cap="Your day starts on Today: every period, every routine,|from morning prayer and O Canada to the next lesson in each subject,\nstraight from your own planning."),
         fr=dict(say="Votre journée commence dans Aujourd'hui : chaque période, chaque routine, de la prière du matin et de l'Ô Canada jusqu'à la prochaine leçon de chaque matière, tirée de votre propre planification.",
                 cap="Votre journée commence dans « Aujourd'hui » : chaque période, chaque routine,|de la prière du matin et de l'Ô Canada jusqu'à la prochaine leçon\nde chaque matière, tirée de votre propre planification.")),
    dict(id="calendar", ch=1,
         en=dict(say="P.A. day, school mass, early dismissal for parent-teacher interviews: your day adjusts on its own.",
                 cap="PA day, school mass, early dismissal for parent-teacher interviews:\nyour day adjusts on its own."),
         fr=dict(say="Journée pédagogique, messe de l'école, départ hâtif pour les rencontres de parents : votre journée s'ajuste toute seule.",
                 cap="Journée pédagogique, messe de l'école, départ hâtif pour les rencontres :\nvotre journée s'ajuste toute seule.")),
    dict(id="taught", ch=1,
         en=dict(say="Taught it? One tap on Lesson taught, and your plan moves ahead. Changed your mind? Undo is one tap too.",
                 cap="Taught it? One tap on Lesson taught, and your plan moves ahead.\nChanged your mind? Undo is one tap too."),
         fr=dict(say="Leçon donnée? Une touche, et votre planification avance. Vous changez d'idée? Annuler, c'est une touche aussi.",
                 cap="Leçon donnée? Une touche, et votre planification avance.\nVous changez d'idée? Annuler, c'est une touche aussi.")),
    dict(id="timetable", ch=1,
         en=dict(say="Weekly schedules or rotating days, rotary periods, combined grades: it follows your real timetable.",
                 cap="Weekly schedules or rotating days, rotary periods, combined grades:\nit follows your real timetable."),
         fr=dict(say="Horaire de la semaine ou jours en rotation, enseignement en rotation, classes combinées : l'application suit votre vrai horaire.",
                 cap="Horaire de la semaine ou jours en rotation, enseignement en rotation,\nclasses combinées : l'application suit votre vrai horaire.")),

    # 2 · Your planning
    dict(id="unit", ch=2,
         en=dict(say="Plan your units lesson by lesson, and attach resources from the library.",
                 cap="Plan your units lesson by lesson,\nand attach resources from the library."),
         fr=dict(say="Planifiez vos unités leçon par leçon, et joignez-y des ressources de la banque.",
                 cap="Planifiez vos unités leçon par leçon,\net joignez-y des ressources de la banque.")),
    dict(id="year", ch=2,
         en=dict(say="My year lays your units across the school year, week by week, next to the calendar, the report card dates and the liturgical seasons.",
                 cap="My year lays your units across the school year, week by week,|next to the calendar, the report card dates and the liturgical seasons."),
         fr=dict(say="Mon année place vos unités sur toute l'année, semaine par semaine, à côté du calendrier, des dates de bulletin et des temps liturgiques.",
                 cap="« Mon année » place vos unités sur toute l'année, semaine par semaine,|à côté du calendrier, des dates de bulletin et des temps liturgiques.")),
    dict(id="coverage", ch=2,
         en=dict(say="Coverage shows, for each curriculum expectation loaded in the app, what you've taught, what's planned, and what isn't planned yet. And your long-range plan prints as a P.D.F.",
                 cap="Coverage shows, for each curriculum expectation loaded in the app,\nwhat you've taught, what's planned, and what isn't planned yet.|And your long-range plan prints as a PDF."),
         fr=dict(say="Couverture montre, pour chaque attente chargée dans l'application, ce qui est enseigné, ce qui est prévu et ce qui n'est pas encore prévu. Et votre plan à long terme s'imprime en PDF.",
                 cap="« Couverture » montre, pour chaque attente chargée dans l'application,\nce qui est enseigné, ce qui est prévu et ce qui n'est pas encore prévu.|Et votre plan à long terme s'imprime en PDF.")),

    # 3 · Resources
    dict(id="library", ch=3,
         en=dict(say="The resource bank is in French, searchable, and filed by curriculum expectation.",
                 cap="The resource bank is in French, searchable,\nand filed by curriculum expectation."),
         fr=dict(say="La banque de ressources est en français, on peut y faire des recherches, et les ressources sont rangées par attente du curriculum.",
                 cap="La banque de ressources est en français, on peut y faire des recherches,\net les ressources sont rangées par attente du curriculum.")),
    dict(id="versions", ch=3,
         en=dict(say="A resource can have a version for each language level, and the student sheet never prints a level name.",
                 cap="A resource can have a version for each language level,\nand the student sheet never prints a level name."),
         fr=dict(say="Une ressource peut avoir une version pour chaque niveau de langue, et la feuille de l'élève n'imprime jamais le nom du niveau.",
                 cap="Une ressource peut avoir une version pour chaque niveau de langue,\net la feuille de l'élève n'imprime jamais le nom du niveau.")),
    dict(id="review", ch=3,
         en=dict(say="Before a resource is shared with the whole board, people your board names approve it, and faith content gets its own review.",
                 cap="Before a resource is shared with the whole board, people your board names\napprove it, and faith content gets its own review."),
         fr=dict(say="Avant d'être partagée avec tout le conseil, une ressource est approuvée par des personnes que votre conseil désigne, et le contenu de foi est révisé à part.",
                 cap="Avant d'être partagée avec tout le conseil, une ressource est approuvée par des personnes\nque votre conseil désigne, et le contenu de foi est révisé à part.")),
    dict(id="differentiate", ch=3,
         en=dict(say="Need the same text at several language levels? Differentiate asks the A.I. Before anything is sent, you see exactly what goes out: the names the app knows are replaced, and you remove any others.",
                 cap="Need the same text at several language levels? Differentiate asks the AI.|Before anything is sent, you see exactly what goes out:\nthe names the app knows are replaced, and you remove any others."),
         fr=dict(say="Besoin du même texte à plusieurs niveaux de langue? Avec Différencier, vous le demandez à l'I.A. Avant l'envoi, vous voyez exactement le texte qui part : les noms que l'application connaît y sont remplacés, et vous retirez les autres.",
                 cap="Besoin du même texte à plusieurs niveaux de langue? Avec « Différencier », vous le demandez à l'IA.|Avant l'envoi, vous voyez exactement le texte qui part : les noms que l'application\nconnaît y sont remplacés, et vous retirez les autres.")),
    dict(id="aicontrols", ch=3,
         en=dict(say="The A.I. stays off until the principal turns it on. Only staff use it, never students, and a board can forbid it in all its schools.",
                 cap="The AI stays off until the principal turns it on.|Only staff use it, never students,\nand a board can forbid it in all its schools."),
         fr=dict(say="L'I.A. reste éteinte tant que la direction ne l'active pas. Seul le personnel l'utilise, jamais les élèves, et un conseil peut l'interdire dans toutes ses écoles.",
                 cap="L'IA reste éteinte tant que la direction ne l'active pas.|Seul le personnel l'utilise, jamais les élèves,\net un conseil peut l'interdire dans toutes ses écoles.")),

    # 4 · In class
    dict(id="projector", ch=4,
         en=dict(say="Present to the class: a quiz on the projector, one question at a time, and the answer only when you ask for it.",
                 cap="Present to the class: a quiz on the projector, one question at a time,\nand the answer only when you ask for it."),
         fr=dict(say="Présenter à la classe : un quiz au projecteur, une question à la fois, et la réponse seulement quand vous la demandez.",
                 cap="« Présenter à la classe » : un quiz au projecteur, une question à la fois,\net la réponse seulement quand vous la demandez.")),
    dict(id="tablets", ch=4,
         en=dict(say="Students can answer on the class tablets with a code. No student accounts: each device is just a number.",
                 cap="Students can answer on the class tablets with a code.\nNo student accounts: each device is just a number."),
         fr=dict(say="Les élèves peuvent répondre sur les tablettes de la classe avec un code. Aucun compte d'élève : chaque appareil n'est qu'un numéro.",
                 cap="Les élèves peuvent répondre sur les tablettes de la classe avec un code.\nAucun compte d'élève : chaque appareil n'est qu'un numéro.")),

    # 5 · A sick day
    dict(id="sick", ch=5,
         en=dict(say="Six a.m., and you wake up sick? Two taps on your phone.",
                 cap="6 a.m., and you wake up sick?\nTwo taps on your phone."),
         fr=dict(say="Six heures du matin, et vous vous réveillez malade? Deux touches sur votre téléphone.",
                 cap="6 h du matin, et vous vous réveillez malade?\nDeux touches sur votre téléphone.")),
    dict(id="plan", ch=5,
         en=dict(say="Your substitute plan builds itself from where each class left off: the next lessons, the groups by language level, the routines, and the office's phone number.",
                 cap="Your substitute plan builds itself from where each class left off:|the next lessons, the groups by language level, the routines,\nand the office's phone number."),
         fr=dict(say="Votre plan de suppléance se prépare tout seul, à partir de là où chaque classe est rendue : les prochaines leçons, les groupes par niveau de langue, les routines et le numéro du secrétariat.",
                 cap="Votre plan de suppléance se prépare tout seul, à partir de là où chaque classe est rendue :|les prochaines leçons, les groupes par niveau de langue, les routines\net le numéro du secrétariat.")),
    dict(id="released", ch=5,
         en=dict(say="Look it over if you like. It goes out on its own at seven thirty, the default time, or sooner if you choose.",
                 cap="Look it over if you like. It goes out on its own at 7:30,\nthe default time, or sooner if you choose."),
         fr=dict(say="Relisez-le si vous le voulez. Il est publié tout seul à sept heures trente, l'heure par défaut, ou plus tôt si vous le décidez.",
                 cap="Relisez-le si vous le voulez. Il est publié tout seul à 7 h 30,\nl'heure par défaut, ou plus tôt si vous le décidez.")),
    dict(id="code", ch=5,
         en=dict(say="The office gives the substitute a code for that day only. No account needed.",
                 cap="The office gives the substitute a code for that day only.\nNo account needed."),
         fr=dict(say="Le secrétariat remet à la personne suppléante un code pour cette journée seulement. Aucun compte requis.",
                 cap="Le secrétariat remet à la personne suppléante un code pour cette journée seulement.\nAucun compte requis.")),
    dict(id="subphone", ch=5,
         en=dict(say="On their phone, the substitute sees what's happening now, and what comes next, all day long.",
                 cap="On their phone, the substitute sees what's happening now,\nand what comes next, all day long."),
         fr=dict(say="Sur son téléphone, la personne suppléante voit ce qui se passe maintenant, et ce qui vient ensuite, toute la journée.",
                 cap="Sur son téléphone, la personne suppléante voit ce qui se passe maintenant,\net ce qui vient ensuite, toute la journée.")),
    dict(id="alerts", ch=5,
         en=dict(say="If your principal turns them on, medical alerts are encrypted and appear only when tapped. A code opens them for whoever holds it, so every view is logged.",
                 cap="If your principal turns them on, medical alerts are encrypted and appear only when tapped.|A code opens them for whoever holds it,\nso every view is logged."),
         fr=dict(say="Si la direction les active, les alertes médicales sont chiffrées et n'apparaissent que sur demande. Un code les ouvre pour quiconque le détient : chaque consultation est donc enregistrée.",
                 cap="Si la direction les active, les alertes médicales sont chiffrées\net n'apparaissent que sur demande.|Un code les ouvre pour quiconque le détient :\nchaque consultation est donc enregistrée.")),
    dict(id="report", ch=5,
         en=dict(say="At the end of the day, the substitute sends a report of what got done.",
                 cap="At the end of the day,\nthe substitute sends a report of what got done."),
         fr=dict(say="En fin de journée, la personne suppléante envoie un suivi de ce qui a été fait.",
                 cap="En fin de journée, la personne suppléante\nenvoie un suivi de ce qui a été fait.")),
    dict(id="confirm", ch=5,
         en=dict(say="It's waiting for you the next morning. You read it, and you confirm it.",
                 cap="It's waiting for you the next morning.\nYou read it, and you confirm it."),
         fr=dict(say="Le lendemain matin, le suivi vous attend. Vous le lisez, et vous le confirmez.",
                 cap="Le lendemain matin, le suivi vous attend.\nVous le lisez, et vous le confirmez.")),

    # 6 · Report cards and families
    dict(id="bulletins", ch=6,
         en=dict(say="Report cards: build each student's comment from your board's comment banks, expectation by expectation.",
                 cap="Report cards: build each student's comment from your board's comment banks,\nexpectation by expectation."),
         fr=dict(say="Bulletins : composez le commentaire de chaque élève à partir des banques de commentaires de votre conseil, attente par attente.",
                 cap="« Bulletins » : composez le commentaire de chaque élève à partir des banques\nde commentaires de votre conseil, attente par attente.")),
    dict(id="ondevice", ch=6,
         en=dict(say="Those comments are written in your browser. They're never sent to our servers, or to the A.I.",
                 cap="Those comments are written in your browser.\nThey're never sent to our servers, or to the AI."),
         fr=dict(say="Ces commentaires sont rédigés dans votre navigateur. Ils ne sont jamais envoyés à nos serveurs, ni à l'I.A.",
                 cap="Ces commentaires sont rédigés dans votre navigateur.\nIls ne sont jamais envoyés à nos serveurs, ni à l'IA.")),
    dict(id="infoparents", ch=6,
         en=dict(say="Info-parents drafts your weekly message to families from your class's own week, in French and in English, side by side.",
                 cap="« Info-parents » drafts your weekly message to families from your class's own week,\nin French and in English, side by side."),
         fr=dict(say="Info-parents prépare votre message de la semaine aux familles à partir de ce que votre classe a vécu, en français et en anglais, côte à côte.",
                 cap="« Info-parents » prépare votre message de la semaine aux familles\nà partir de ce que votre classe a vécu, en français et en anglais, côte à côte.")),
    dict(id="print", ch=6,
         en=dict(say="You read it over, then copy it or print it. The app itself sends nothing to families.",
                 cap="You read it over, then copy it or print it.\nThe app itself sends nothing to families."),
         fr=dict(say="Vous le relisez, puis vous le copiez ou l'imprimez. L'application, elle, n'envoie rien aux familles.",
                 cap="Vous le relisez, puis vous le copiez ou l'imprimez.\nL'application, elle, n'envoie rien aux familles.")),

    # 7 · Principals
    dict(id="direction", ch=7,
         en=dict(say="For the principal, seven forty-five at a glance: today's absences, each plan's status, the codes issued, and the reports received.",
                 cap="For the principal, 7:45 at a glance: today's absences, each plan's status,\nthe codes issued, and the reports received."),
         fr=dict(say="Pour la direction, sept heures quarante-cinq d'un coup d'œil : les absences du jour, l'état de chaque plan, les codes remis et les suivis reçus.",
                 cap="Pour la direction, 7 h 45 d'un coup d'œil : les absences du jour, l'état de chaque plan,\nles codes remis et les suivis reçus.")),
    dict(id="audit", ch=7,
         en=dict(say="The audit log shows every alert read, with the code used, and flags the codes the office issued.",
                 cap="The audit log shows every alert read, with the code used,\nand flags the codes the office issued."),
         fr=dict(say="Le journal d'audit montre chaque consultation d'alerte, avec le code utilisé, et signale les codes émis par le secrétariat.",
                 cap="Le journal d'audit montre chaque consultation d'alerte, avec le code utilisé,\net signale les codes émis par le secrétariat.")),
    dict(id="yours", ch=7,
         en=dict(say="And teachers' planning stays theirs: the dashboard never shows units, lessons or progress.",
                 cap="And teachers' planning stays theirs:\nthe dashboard never shows units, lessons or progress."),
         fr=dict(say="Et la planification reste celle du personnel enseignant : le tableau de bord ne montre jamais les unités, les leçons ni la progression.",
                 cap="Et la planification reste celle du personnel enseignant :\nle tableau de bord ne montre jamais les unités, les leçons ni la progression.")),

    # 8 · School boards
    dict(id="staff", ch=8,
         en=dict(say="The board invites its staff, assigns their roles, and can remove a person's access.",
                 cap="The board invites its staff, assigns their roles,\nand can remove a person's access."),
         fr=dict(say="Le conseil invite son personnel, attribue les rôles, et peut retirer l'accès d'une personne.",
                 cap="Le conseil invite son personnel, attribue les rôles,\net peut retirer l'accès d'une personne.")),
    dict(id="board", ch=8,
         en=dict(say="It sees A.I. use school by school, the system's health, and what's erased each night once its retention period ends.",
                 cap="It sees AI use school by school, the system's health,\nand what's erased each night once its retention period ends."),
         fr=dict(say="Il voit l'utilisation de l'I.A. par école, l'état du système, et ce qui est effacé chaque nuit à la fin de sa durée de conservation.",
                 cap="Il voit l'utilisation de l'IA par école, l'état du système,\net ce qui est effacé chaque nuit à la fin de sa durée de conservation.")),
    dict(id="hosting", ch=8,
         en=dict(say=f"{APP} is designed to be hosted in Canada, or on your board's own servers, with encrypted, signed backups.",
                 cap=f"{APP} is designed to be hosted in Canada, or on your board's own servers,\nwith encrypted, signed backups."),
         fr=dict(say=f"{APP} est conçue pour être hébergée au Canada, ou sur les serveurs de votre conseil, avec des sauvegardes chiffrées et signées.",
                 cap=f"{APP} est conçue pour être hébergée au Canada, ou sur les serveurs de votre conseil,\navec des sauvegardes chiffrées et signées.")),

    # 9 · Privacy first
    dict(id="privacy", ch=9,
         en=dict(say="Privacy comes first: students are first names only, sensitive access is logged, report card comments stay on your device, and students never use the A.I.",
                 cap="Privacy comes first: students are first names only, sensitive access is logged,\nreport card comments stay on your device, and students never use the AI."),
         fr=dict(say="La confidentialité d'abord : les élèves, c'est le prénom seulement, les accès sensibles sont enregistrés, les commentaires de bulletin restent sur votre appareil, et les élèves n'utilisent jamais l'I.A.",
                 cap="La confidentialité d'abord : le prénom des élèves seulement, des accès sensibles enregistrés,\ndes commentaires de bulletin sur votre appareil, et jamais d'IA pour les élèves.")),

    # 10 · Getting started
    dict(id="start", ch=10,
         en=dict(say="Your first sign-in comes with a short checklist, and a sample class you can add to try things out without touching your real one.",
                 cap="Your first sign-in comes with a short checklist, and a sample class\nyou can add to try things out without touching your real one."),
         fr=dict(say="Dès la première connexion, une courte liste pour bien commencer, et une classe exemple, à ajouter si vous le voulez, pour faire des essais sans toucher à la vraie.",
                 cap="Dès la première connexion, une courte liste pour bien commencer, et une classe exemple,\nà ajouter si vous le voulez, pour faire des essais sans toucher à la vraie.")),
    dict(id="bilingual", ch=10,
         en=dict(say="It's in French first, with English on the sign-in page or in your profile, on a phone, a tablet or a computer.",
                 cap="In French first, with English on the sign-in page or in your profile,\non a phone, a tablet or a computer."),
         fr=dict(say="En français d'abord, avec l'anglais à la connexion ou dans votre profil, sur un téléphone, une tablette ou un ordinateur.",
                 cap="En français d'abord, avec l'anglais à la connexion ou dans votre profil,\nsur un téléphone, une tablette ou un ordinateur.")),
    dict(id="feedback", ch=10,
         en=dict(say="And there's a feedback button on every page, because this pilot is being built with you.",
                 cap="And there's a feedback button on every page,\nbecause this pilot is being built with you."),
         fr=dict(say="Et il y a un bouton Commentaires sur chaque page, parce que ce projet pilote se construit avec vous.",
                 cap="Et il y a un bouton « Commentaires » sur chaque page,\nparce que ce projet pilote se construit avec vous.")),

    dict(id="end", ch=0,
         en=dict(say=f"{APP}. Less paperwork, more teaching. It's a pilot build, not online yet. Join the pilot.",
                 cap=f"{APP}. Less paperwork, more teaching.\nA pilot build, not online yet. Join the pilot."),
         fr=dict(say=f"{APP}. Moins de paperasse, plus d'enseignement. C'est une version pilote, pas encore en ligne. Joignez-vous au projet pilote.",
                 cap=f"{APP}. Moins de paperasse, plus d'enseignement.\nUne version pilote, pas encore en ligne. Joignez-vous au projet pilote.")),
]


NBSP, NNBSP = "\u00a0", "\u202f"


def fr_typo(s: str) -> str:
    """French typography for anything shown on screen (marketing/README.md): curly apostrophes, a
    no-break space before « : » and inside « », in times and in « 1 000 », a narrow one before ? ! ;"""
    s = s.replace("'", "\u2019")
    s = re.sub(r" ?([?!;]+)", NNBSP + r"\1", s)
    s = re.sub(r" :", NBSP + ":", s)
    s = s.replace("« ", "«" + NBSP).replace(" »", NBSP + "»")
    s = re.sub(r"(\d) h (\d)", r"\1" + NBSP + "h" + NBSP + r"\2", s)
    s = re.sub(r"(\d) h\b", r"\1" + NBSP + "h", s)
    s = re.sub(r"(\d) (\d{3})\b", r"\1" + NBSP + r"\2", s)
    s = re.sub(r"(Élève|Adulte) ([A-Z])\b", r"\1" + NBSP + r"\2", s)
    return s


def lines(lang: str) -> list[dict]:
    """Flat list for one language: id, ch, say, cap (French captions get French typography)."""
    out = []
    for l in LINES:
        d = dict(id=l["id"], ch=l["ch"], **l[lang])
        if lang == "fr":
            d["cap"] = fr_typo(d["cap"])
        out.append(d)
    return out
