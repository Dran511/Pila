import { useEffect, useState } from 'react'

// The public pages (join + ticket) speak English and Filipino.

export type Lang = 'en' | 'fil'

const en = {
  getTicket: 'Get a queue number',
  chooseService: 'What do you need today?',
  waiting: (n: number) => (n === 1 ? '1 person waiting' : `${n} people waiting`),
  noLine: 'No line right now',
  estWait: 'Estimated wait',
  yourName: 'Your name (optional)',
  yourNameHint: 'So staff can greet you. It is never shown on the public screen.',
  priority: 'Priority lane',
  priorityHint: 'Senior citizen, person with disability, or pregnant. Please show your ID at the counter.',
  submit: 'Get my number',
  closed: 'This office is not accepting online tickets right now. Please ask the staff at the entrance.',
  officeNotFound: 'We couldn’t find this office. Check the link or scan the QR code again.',
  yourNumber: 'Your number',
  aheadOfYou: (n: number) => (n === 0 ? 'You’re next!' : n === 1 ? '1 person ahead of you' : `${n} people ahead of you`),
  getReady: 'Get ready, it’s almost your turn. Please stay near the counters.',
  proceedTo: 'Please proceed to',
  itsYourTurn: 'It’s your turn!',
  done: 'All done. Salamat!',
  doneHint: 'Thank you for visiting. You can close this page.',
  noShow: 'You were called but missed your turn.',
  noShowHint: 'Please talk to the staff if you’re still here.',
  cancelled: 'You left the line.',
  getAnother: 'Get a new number',
  leaveLine: 'Leave the line',
  confirmLeave: 'Leave the line? You will lose your place.',
  notifyMe: 'Alert me when it’s my turn',
  notifyOn: 'Alerts on: keep this page open',
  notifyBlocked: 'Notifications are blocked in your browser settings; keep this page open and we’ll beep.',
  nowServing: 'Now serving',
  idle: '—',
  issuedAt: 'Issued',
  keepOpen: 'Keep this page open. It updates by itself, and you can lock your phone screen.',
  activeTicket: (code: string) => `You already have number ${code}`,
  viewTicket: 'View my ticket',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  showStaff: 'Show this screen to the staff',
}

const fil: typeof en = {
  getTicket: 'Kumuha ng numero',
  chooseService: 'Ano ang kailangan mo ngayon?',
  waiting: (n: number) => (n === 1 ? '1 taong naghihintay' : `${n} taong naghihintay`),
  noLine: 'Walang pila ngayon',
  estWait: 'Tantiyang paghihintay',
  yourName: 'Pangalan mo (hindi kailangan)',
  yourNameHint: 'Para matawag ka ng staff. Hindi ito ipapakita sa pampublikong screen.',
  priority: 'Priority lane',
  priorityHint: 'Senior citizen, PWD, o buntis. Ipakita ang ID sa counter.',
  submit: 'Kunin ang numero ko',
  closed: 'Hindi tumatanggap ng online na numero ang opisinang ito ngayon. Magtanong sa staff sa pasukan.',
  officeNotFound: 'Hindi namin mahanap ang opisinang ito. Suriin ang link o i-scan muli ang QR code.',
  yourNumber: 'Ang numero mo',
  aheadOfYou: (n: number) => (n === 0 ? 'Ikaw na ang susunod!' : n === 1 ? '1 tao ang nauuna sa iyo' : `${n} tao ang nauuna sa iyo`),
  getReady: 'Maghanda, malapit ka nang tawagin. Manatili malapit sa mga counter.',
  proceedTo: 'Pumunta sa',
  itsYourTurn: 'Ikaw na!',
  done: 'Tapos na. Salamat!',
  doneHint: 'Salamat sa pagbisita. Maaari mo nang isara ang page na ito.',
  noShow: 'Natawag ka pero wala ka sa counter.',
  noShowHint: 'Kausapin ang staff kung nandito ka pa.',
  cancelled: 'Umalis ka na sa pila.',
  getAnother: 'Kumuha ng bagong numero',
  leaveLine: 'Umalis sa pila',
  confirmLeave: 'Aalis sa pila? Mawawala ang puwesto mo.',
  notifyMe: 'Abisuhan ako kapag ako na',
  notifyOn: 'Naka-on ang abiso: huwag isara ang page',
  notifyBlocked: 'Naka-block ang notifications sa browser mo; huwag isara ang page at magbe-beep kami.',
  nowServing: 'Tinatawag ngayon',
  idle: '—',
  issuedAt: 'Kinuha',
  keepOpen: 'Huwag isara ang page na ito. Kusa itong nag-a-update, at puwede mong i-lock ang phone mo.',
  activeTicket: (code: string) => `May numero ka na: ${code}`,
  viewTicket: 'Tingnan ang numero ko',
  live: 'Live',
  reconnecting: 'Kumokonekta muli…',
  showStaff: 'Ipakita ang screen na ito sa staff',
}

const dictionaries = { en, fil }

export function useLang() {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('pila.lang')
      if (saved === 'en' || saved === 'fil') return saved
    } catch {
      /* storage unavailable */
    }
    return navigator.language.startsWith('fil') || navigator.language.startsWith('tl') ? 'fil' : 'en'
  })
  useEffect(() => {
    document.documentElement.lang = lang === 'fil' ? 'fil' : 'en'
  }, [lang])
  const setLang = (l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem('pila.lang', l)
    } catch {
      /* ignore */
    }
  }
  return { lang, setLang, t: dictionaries[lang] }
}
