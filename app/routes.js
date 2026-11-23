//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()
const giasData = require('./data/gias_prototype.json')
// Official GIAS predecessor and successor links, from links_edubasealldata.
const linksData = require('./data/links.json')
const governanceData = require('./data/governance.json')
// Government office region (GOR), keyed by URN, from the GIAS extract of 26 March 2026.
// Providers missing from that extract get 'Not recorded'.
const regionByUrn = require('./data/regions.json')
// Attach each provider's region. Groups have no region of their own.
giasData.forEach(function (x) {
  if (x.id_type === 'URN') x.region = regionByUrn[x.id] || 'Not recorded'
})

// ---------------------------------------------------------------------------
// DOWNLOAD
// ---------------------------------------------------------------------------

router.post('/download/start', function (req, res) {
  res.redirect('/downloading')
})


// ---------------------------------------------------------------------------
// SEARCH
// ---------------------------------------------------------------------------

const RESULTS_PER_PAGE = 20

// Facet counters. Each filter with a list of options has one. They run over
// records to count how many have each value, and they run twice: once over the
// whole register (the full list of options, so none ever disappears) and once
// per search (how many results each option would return, with every other
// search term and filter applied).
function inc (bag, key) { bag[key] = (bag[key] || 0) + 1 }
function incOrNotRecorded (bag, key) {
  if (key === null || key === undefined || key === '') key = 'Not recorded'
  inc(bag, key)
}
const FACET_COUNTERS = {
  region: function (i, b) { if (i.id_type === 'URN') incOrNotRecorded(b, i.region) },
  status: function (i, b) { if (i.status) inc(b, i.status) },
  type: function (i, b) {
    if (i.id_type === 'URN' && i.type_group) {
      inc(b.groups, i.type_group)
      if (i.type_detail) {
        if (!b.details[i.type_group]) b.details[i.type_group] = {}
        inc(b.details[i.type_group], i.type_detail)
      }
    }
  },
  group_type: function (i, b) { if ((i.id_type === 'UID' || i.id_type === 'Group UID') && i.type) inc(b, i.type) },
  phase: function (i, b) { if (i.phase) inc(b, i.phase) },
  gender: function (i, b) { if (i.gender) inc(b, i.gender) },
  religious_character: function (i, b) { if (i.religious_character) inc(b, i.religious_character) },
  religious_ethos: function (i, b) { if (i.religious_ethos) inc(b, i.religious_ethos) },
  section_41: function (i, b) { if (i.section_41) inc(b, i.section_41) },
  boarding: function (i, b) { if (i.id_type === 'URN') incOrNotRecorded(b, i.boarding) },
  nursery_provision: function (i, b) { if (i.id_type === 'URN') incOrNotRecorded(b, i.nursery_provision) },
  sixth_form: function (i, b) { if (i.id_type === 'URN') incOrNotRecorded(b, i.sixth_form) },
  admissions_policy: function (i, b) { if (i.id_type === 'URN') incOrNotRecorded(b, i.admissions_policy) },
  special_classes: function (i, b) { if (i.id_type === 'URN') incOrNotRecorded(b, i.special_classes) },
  resourced_provision: function (i, b) { if (i.id_type === 'URN') incOrNotRecorded(b, i.resourced_provision) },
  fe_type: function (i, b) { if (i.id_type === 'URN' && i.fe_type) inc(b, i.fe_type) },
  sen_type: function (i, b) {
    if (i.id_type !== 'URN') return
    // sen_types is an array: a record counts under each type it has, or once
    // as "Not recorded" when it has none.
    var t = i.sen_types || []
    if (t.length === 0) inc(b, 'Not recorded')
    else t.forEach(function (x) { inc(b, x) })
  }
}
const FACET_KEYS = Object.keys(FACET_COUNTERS)
function newFacetBag (key) { return key === 'type' ? { groups: {}, details: {} } : {} }
const FACET_UNIVERSE = {}
FACET_KEYS.forEach(function (k) { FACET_UNIVERSE[k] = newFacetBag(k) })
giasData.forEach(function (i) { FACET_KEYS.forEach(function (k) { FACET_COUNTERS[k](i, FACET_UNIVERSE[k]) }) })

// Every option the register has for a facet, at zero, overlaid with the counts.
function withZeros (universeBag, bag) {
  var out = {}
  Object.keys(universeBag).forEach(function (k) { out[k] = 0 })
  Object.keys(bag).forEach(function (k) { out[k] = bag[k] })
  return out
}
// An option with no matches stays in the list as a greyed-out, disabled
// checkbox, unless it is ticked (so it can still be unticked). The suffix means
// the state is not carried by the faded styling alone.
function unavailableOption (o) {
  return {
    value: o.value,
    text: o.text + ' (no matches)',
    disabled: true
  }
}
function finishOptions (options, counts) {
  return options.map(function (o) { return (o.checked || counts[o.value] > 0) ? o : unavailableOption(o) })
}

// Search runs against the full dataset (open and closed). Whether closed
// records appear is controlled at request time by the "Show open providers
// only" toggle and the Status filter — not by pre-splitting the data.
const allData = giasData
const urnIndex = new Map()
giasData.forEach(function (x) { if (x.id_type === 'URN') urnIndex.set(x.id, x) })

// A provider's `part_of` is a list of groups (or null), since a school can
// belong to more than one — e.g. a federation and a shared foundation trust.
function partOfGroups (item) {
  return Array.isArray(item.part_of) ? item.part_of : []
}
function isMemberOf (item, groupUid) {
  return partOfGroups(item).some(function (g) { return g.group_uid === groupUid })
}
function partOfMatches (item, needle) {
  return partOfGroups(item).some(function (g) {
    return (g.group_name && g.group_name.toLowerCase().indexOf(needle) !== -1) ||
      (g.group_uid && g.group_uid.toLowerCase().indexOf(needle) !== -1)
  })
}

// DfE number (LAESTAB) is a 3-digit local authority code plus a 4-digit
// establishment number, held as "861/7007". People type it several ways:
// 861/7007, 8617007, 861 7007 or 861-7007. Compare on digits only.
function digitsOnly (v) { return String(v || '').replace(/\D/g, '') }
function dfeNumberMatches (item, rawQuery) {
  if (!item.dfe_number) return false
  var q = String(rawQuery || '').trim()
  var itemDigits = digitsOnly(item.dfe_number)
  // Seven digits with no separator: exact match on the whole DfE number.
  if (/^\d{7}$/.test(q)) return itemDigits === q
  // Three digits, a separator, then some of the establishment number.
  if (/^\d{3}\s*[\/\-]\s*\d{1,4}$|^\d{3}\s+\d{1,4}$/.test(q)) {
    var qDigits = digitsOnly(q)
    return qDigits.length >= 4 && itemDigits.indexOf(qDigits) === 0
  }
  return false
}

// ---------------------------------------------------------------------------
// CSV export (live downloads on the results page and record pages)
// ---------------------------------------------------------------------------

// Source dates are day-first (DD-MM-YYYY or DD/MM/YYYY); exports use ISO dates
// so they sort and import cleanly.
function isoDate (d) {
  if (!d) return ''
  var m = String(d).trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : String(d)
}
function csvCell (v) {
  if (v === null || v === undefined) return ''
  var t = String(v)
  return /[",\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t
}
var CSV_COLUMNS = [
  ['URN or UID', function (x) { return x.id }],
  ['Record type', function (x) { return x.id_type }],
  ['Name', function (x) { return x.name }],
  ['Type', function (x) { return x.type }],
  ['Detailed type', function (x) { return x.type_detail }],
  ['Operating status', function (x) { return x.status }],
  ['Open date', function (x) { return isoDate(x.open_date) }],
  ['Closed date', function (x) { return isoDate(x.close_date) }],
  ['Region', function (x) { return x.region }],
  ['Local authority', function (x) { return x.local_authority }],
  ['Phase of education', function (x) { return x.phase }],
  ['Street', function (x) { return x.street }],
  ['Town', function (x) { return x.town }],
  ['County', function (x) { return x.county === 'Not recorded' ? '' : x.county }],
  ['Postcode', function (x) { return x.postcode }],
  ['DfE number (LAESTAB)', function (x) { return x.dfe_number }],
  ['UKPRN', function (x) { return x.ukprn }],
  ['Gender', function (x) { return x.gender }],
  ['Age low', function (x) { return x.age_low }],
  ['Age high', function (x) { return x.age_high }],
  ['School capacity', function (x) { return x.max_students }],
  ['Number of pupils', function (x) { return x.pupil_numbers && x.pupil_numbers.total }],
  ['Pupils in resourced provision', function (x) { return x.resourced_pupils }],
  ['Resourced provision capacity', function (x) { return x.resourced_capacity }],
  ['Pupils in SEN unit', function (x) { return x.sen_unit_pupils }],
  ['SEN unit capacity', function (x) { return x.sen_unit_capacity }],
  ['Type of SEN provision', function (x) { return (x.sen_types || []).filter(function (t) { return t !== 'Not recorded' }).join('; ') }],
  ['Resourced provision', function (x) { return x.resourced_provision }],
  ['Section 41 (approved for SEND provision)', function (x) { return x.section_41 === 'Approved' ? 'Yes' : (x.section_41 === 'Not approved' ? 'No' : '') }],
  ['Boarding provision', function (x) { return x.boarding }],
  ['Nursery provision', function (x) { return x.nursery_provision }],
  ['Sixth form provision', function (x) { return x.sixth_form }],
  ['Admissions policy', function (x) { return x.admissions_policy }],
  ['Special classes', function (x) { return x.special_classes }],
  ['Religious character', function (x) { return x.religious_character }],
  ['Diocese', function (x) { return x.diocese }],
  ['Website', function (x) { return x.website && x.website.href }],
  ['Headteacher', function (x) { return x.headteacher }],
  ['Date last changed/confirmed', function (x) { return isoDate(x.last_changed) }],
  ['Part of group', function (x) { return partOfGroups(x).map(function (g) { return g.group_name }).join('; ') }]
]
function sendCsv (res, fileName, records) {
  var lines = [CSV_COLUMNS.map(function (c) { return csvCell(c[0]) }).join(',')]
  records.forEach(function (x) {
    lines.push(CSV_COLUMNS.map(function (c) { return csvCell(c[1](x)) }).join(','))
  })
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="' + fileName + '"'
  })
  // Byte order mark so Excel opens the file as UTF-8.
  res.send('\uFEFF' + lines.join('\r\n') + '\r\n')
}

router.get('/download/record/:id', function (req, res) {
  var item = giasData.find(function (x) { return x.id === req.params.id })
  if (!item) return res.status(404).render('404')
  sendCsv(res, 'record-' + item.id + '.csv', [item])
})


// Full value lists for the autocomplete filter facets (computed once).
// These power the Local authority and Diocese "type to filter" inputs.
const allLocalAuthorities = Array.from(new Set(
  giasData.map(function (x) { return x.local_authority }).filter(Boolean)
)).sort()

const allDioceses = Array.from(new Set(
  giasData.map(function (x) { return x.diocese }).filter(Boolean)
)).sort()

// Index page
router.get('/index', function (req, res) {
  res.render('index')
})

// Autocomplete API endpoint
router.get('/api/schools', function (req, res) {
  var q = (req.query.q || '').replace(/\s+/g, ' ').trim().toLowerCase()

  if (q.length < 2) {
    return res.json([])
  }

  var results = allData.filter(function (item) {
    return (
      (item.name && item.name.toLowerCase().indexOf(q) !== -1) ||
      (item.id && item.id.toLowerCase().indexOf(q) !== -1) ||
      (item.local_authority && item.local_authority.toLowerCase().indexOf(q) !== -1) ||
      dfeNumberMatches(item, q) ||
      partOfMatches(item, q)
    )
  })

  res.json(results.slice(0, 20).map(function (item) {
    var identifier = item.id_type + ': ' + item.id
    var la = item.local_authority ? ' — ' + item.local_authority : ''
    return item.name + ' (' + identifier + ')' + la
  }))
})

// Results page
router.get('/results', function (req, res) {
  // Collapse repeated spaces so a stray double space can't stop a match.
  var q = (req.query.what || '').replace(/\s+/g, ' ').trim()
  var where = (req.query.where || '').replace(/\s+/g, ' ').trim()
  var exactId = (req.query.id || '').trim()
  var currentPage = parseInt(req.query.page) || 1

  // Active filters
  var activeTypes = [].concat(req.query.type || []).filter(function (v) { return v !== '_unchecked' })
  var activeStatuses = [].concat(req.query.status || []).filter(function (v) { return v !== '_unchecked' && v !== '_all' })
  var activeGroupTypes = [].concat(req.query.group_type || []).filter(function (v) { return v !== '_unchecked' })
  var activeLAs = [].concat(req.query.local_authority || []).filter(function (v) { return v !== '_unchecked' })
  var activeSen = [].concat(req.query.sen_provision || []).filter(function (v) { return v !== '_unchecked' })
  var activeRegions = [].concat(req.query.region || []).filter(function (v) { return v !== '_unchecked' })
  var activePhases = [].concat(req.query.phase || []).filter(function (v) { return v !== '_unchecked' })
  var activeGenders = [].concat(req.query.gender || []).filter(function (v) { return v !== '_unchecked' })
  var activeReligions = [].concat(req.query.religious_character || []).filter(function (v) { return v !== '_unchecked' })
  var activeDioceses = [].concat(req.query.diocese || []).filter(function (v) { return v !== '_unchecked' })
  var activeSection41 = [].concat(req.query.section_41 || []).filter(function (v) { return v !== '_unchecked' })
  var activeBoarding = [].concat(req.query.boarding || []).filter(function (v) { return v !== '_unchecked' })
  var activeNursery = [].concat(req.query.nursery_provision || []).filter(function (v) { return v !== '_unchecked' })
  var activeSixthForm = [].concat(req.query.sixth_form || []).filter(function (v) { return v !== '_unchecked' })
  var activeAdmissions = [].concat(req.query.admissions_policy || []).filter(function (v) { return v !== '_unchecked' })
  var activeSpecialClasses = [].concat(req.query.special_classes || []).filter(function (v) { return v !== '_unchecked' })
  var activeSenTypes = [].concat(req.query.sen_type || []).filter(function (v) { return v !== '_unchecked' })
  var activeFeTypes = [].concat(req.query.fe_type || []).filter(function (v) { return v !== '_unchecked' })
  var activeResourced = [].concat(req.query.resourced_provision || []).filter(function (v) { return v !== '_unchecked' })
  var activeEthos = [].concat(req.query.religious_ethos || []).filter(function (v) { return v !== '_unchecked' })

  // Range filters (From/To). Empty string means unbounded on that side.
  var ageFrom = parseInt(req.query.age_from) ; if (isNaN(ageFrom)) ageFrom = null
  var ageTo = parseInt(req.query.age_to) ; if (isNaN(ageTo)) ageTo = null
  function ymd (prefix) {
    var y = (req.query[prefix + '_year'] || '').trim()
    var m = (req.query[prefix + '_month'] || '').trim()
    var d = (req.query[prefix + '_day'] || '').trim()
    if (!y && !m && !d) return null
    // build a comparable YYYYMMDD number; missing parts default to boundary
    return { y: y, m: m, d: d }
  }
  var openFrom = ymd('open_from')
  var openTo = ymd('open_to')
  var closeFrom = ymd('close_from')
  var closeTo = ymd('close_to')

  // Record kind: 'provider' (URN) or 'group' (UID / Group UID). Drives the
  // "Education providers only" / "Provider groups only" quick-search links.
  var kind = (req.query.kind === 'provider' || req.query.kind === 'group') ? req.query.kind : null

  // Sort order: 'az' (default) or 'za'
  var sortOrder = (req.query.sort === 'za') ? 'za' : 'az'

  // "Include closed education providers" toggle from the search panel.
  // Closed providers and groups are hidden by default; this opts them back in.
  // The kit's checkboxes send a hidden "_unchecked" value too, so a ticked box
  // arrives as an array (['_unchecked', 'yes']) rather than the string 'yes'.
  var includeClosed = [].concat(req.query.include_closed || []).indexOf('yes') !== -1

  // Operating status defaults to the open statuses, shown as selected filters,
  // so people can see (and remove) the assumption that they want open records.
  // An explicit status choice, including "none ticked" (status=_all), wins.
  // "Include closed" switches the default off. effQuery is req.query plus the
  // default, used when building links so they carry the effective filters.
  var DEFAULT_STATUSES = ['Open', 'Open, but proposed to close']
  var effQuery = Object.assign({}, req.query)
  if (req.query.status === undefined && !includeClosed) {
    activeStatuses = DEFAULT_STATUSES.slice()
    effQuery.status = DEFAULT_STATUSES.slice()
  }
  var effReq = { query: effQuery }

  // Status handling: an explicit Status filter always takes precedence. When no
  // status is ticked, closed records are hidden unless "Include closed" is set.

  // Base search against active data only
  var searchResults = []

  // Two independent text predicates, combined with AND:
  //  - q     matches name and ID codes only ("what")
  //  - where matches location fields: postcode, town, county, LA, street
  // Either can be used alone; when both are present a record must match both.
  // "Show all" only applies when neither field is used (q is empty or '*').
  var qLower = q.toLowerCase()
  var whereLower = where.toLowerCase()

  function matchesQ(item) {
    return (
      (item.name && item.name.toLowerCase().indexOf(qLower) !== -1) ||
      (item.id && item.id.toLowerCase().indexOf(qLower) !== -1) ||
      (item.ukprn && item.ukprn.toLowerCase().indexOf(qLower) !== -1) ||
      (item.dfe_number && item.dfe_number.toLowerCase().indexOf(qLower) !== -1) ||
      dfeNumberMatches(item, q) ||
      partOfMatches(item, qLower)
    )
  }

  function matchesWhere(item) {
    return (
      (item.postcode && item.postcode.toLowerCase().indexOf(whereLower) !== -1) ||
      (item.town && item.town.toLowerCase().indexOf(whereLower) !== -1) ||
      (item.county && item.county.toLowerCase().indexOf(whereLower) !== -1) ||
      (item.local_authority && item.local_authority.toLowerCase().indexOf(whereLower) !== -1) ||
      (item.street && item.street.toLowerCase().indexOf(whereLower) !== -1)
    )
  }

  var hasQ = q.length > 0 && q !== '*'
  var hasWhere = where.length > 0

  if (exactId) {
    searchResults = allData.filter(function (item) {
      return item.id === exactId
    })
  } else if (!hasQ && !hasWhere) {
    // No search terms (fresh load or explicit '*') — show everything
    searchResults = allData
  } else {
    searchResults = allData.filter(function (item) {
      return (!hasQ || matchesQ(item)) && (!hasWhere || matchesWhere(item))
    })
  }

  // Which filters does a record fail? An empty list means it is a result.
  // A record that fails only one filter still counts towards that filter's own
  // options, so each filter shows what ticking it would return given every
  // other search term and filter.
  function catMatch (active, value) {
    if (active.length === 0) return true
    if (active.indexOf('Not recorded') !== -1 && (value === null || value === undefined || value === '')) return true
    return active.indexOf(value) !== -1
  }
  function failures (item) {
    var f = []
    // Record kind: provider = URN, group = UID / Group UID.
    if (kind === 'provider' && item.id_type !== 'URN') f.push('kind')
    if (kind === 'group' && item.id_type !== 'UID' && item.id_type !== 'Group UID') f.push('kind')
    // Operating status: the effective selection (the open statuses by default,
    // none when "Include closed" is ticked or every status has been removed).
    if (activeStatuses.length > 0 && activeStatuses.indexOf(item.status) === -1) f.push('status')
    // Provider type accordion filters on the detailed type (child checkboxes).
    if (activeTypes.length > 0 && activeTypes.indexOf(item.type_detail) === -1) f.push('type')
    // Group type filters on a group's type; providers have no group type so a
    // group-type selection excludes them (mirrors the provider-type facet).
    if (activeGroupTypes.length > 0 && activeGroupTypes.indexOf(item.type) === -1) f.push('group_type')
    if (activeLAs.length > 0 && activeLAs.indexOf(item.local_authority) === -1) f.push('local_authority')
    if (activeSen.length > 0 && activeSen.indexOf(String(item.sen_provision)) === -1) f.push('sen')
    if (activeRegions.length > 0 && activeRegions.indexOf(item.region) === -1) f.push('region')
    if (activePhases.length > 0 && activePhases.indexOf(item.phase) === -1) f.push('phase')
    if (activeGenders.length > 0 && activeGenders.indexOf(item.gender) === -1) f.push('gender')
    if (activeReligions.length > 0 && activeReligions.indexOf(item.religious_character) === -1) f.push('religious_character')
    if (activeEthos.length > 0 && activeEthos.indexOf(item.religious_ethos) === -1) f.push('religious_ethos')
    if (activeDioceses.length > 0 && activeDioceses.indexOf(item.diocese) === -1) f.push('diocese')
    if (activeSection41.length > 0 && activeSection41.indexOf(item.section_41) === -1) f.push('section_41')
    // "Not recorded" matches null/empty fields.
    if (!catMatch(activeBoarding, item.boarding)) f.push('boarding')
    if (!catMatch(activeNursery, item.nursery_provision)) f.push('nursery_provision')
    if (!catMatch(activeSixthForm, item.sixth_form)) f.push('sixth_form')
    if (!catMatch(activeAdmissions, item.admissions_policy)) f.push('admissions_policy')
    if (!catMatch(activeSpecialClasses, item.special_classes)) f.push('special_classes')
    if (!catMatch(activeFeTypes, item.fe_type)) f.push('fe_type')
    if (!catMatch(activeResourced, item.resourced_provision)) f.push('resourced_provision')
    // SEN type: item.sen_types is an array; match if any active type is present.
    if (activeSenTypes.length > 0) {
      var st = item.sen_types || []
      var hit = activeSenTypes.some(function (t) {
        if (t === 'Not recorded') return st.length === 0 || st.indexOf('Not recorded') !== -1
        return st.indexOf(t) !== -1
      })
      if (!hit) f.push('sen_type')
    }
    // Age range: item covers ages age_low..age_high. Overlap test with From/To.
    if (ageFrom !== null && item.age_high !== null && item.age_high !== undefined && item.age_high < ageFrom) f.push('age')
    if (ageTo !== null && item.age_low !== null && item.age_low !== undefined && item.age_low > ageTo) f.push('age')
    // Date ranges (open_date / close_date are day-first strings)
    if (!dateInRange(item.open_date, openFrom, openTo)) f.push('open_date')
    if (!dateInRange(item.close_date, closeFrom, closeTo)) f.push('close_date')
    return f
  }

  var facetBags = {}
  FACET_KEYS.forEach(function (k) { facetBags[k] = newFacetBag(k) })
  var laCounts = {}
  var dioceseCounts = {}
  var typeCounts = {}
  var filteredResults = []
    // Results per record kind under the search and every filter except the kind itself, for the record type links.
  var kindCounts = { all: 0, provider: 0, group: 0 }
  searchResults.forEach(function (item) {
    if (item.local_authority) inc(laCounts, item.local_authority)
    if (item.diocese) inc(dioceseCounts, item.diocese)
    var f = failures(item)
      if (f.filter(function (k) { return k !== 'kind' }).length === 0) {
      kindCounts.all++
      kindCounts[item.id_type === 'URN' ? 'provider' : 'group']++
    }
    if (f.length === 0) {
      filteredResults.push(item)
      if (item.type) inc(typeCounts, item.type)
    }
    FACET_KEYS.forEach(function (k) {
      if (f.length === 0 || (f.length === 1 && f[0] === k)) FACET_COUNTERS[k](item, facetBags[k])
    })
  })

  // Counts per option, with every option the register has listed (at zero).
  var statusCounts = withZeros(FACET_UNIVERSE.status, facetBags.status)
  var groupTypeCounts = withZeros(FACET_UNIVERSE.group_type, facetBags.group_type)
  var regionCounts = withZeros(FACET_UNIVERSE.region, facetBags.region)
  var phaseCounts = withZeros(FACET_UNIVERSE.phase, facetBags.phase)
  var genderCounts = withZeros(FACET_UNIVERSE.gender, facetBags.gender)
  var religionCounts = withZeros(FACET_UNIVERSE.religious_character, facetBags.religious_character)
  var ethosCounts = withZeros(FACET_UNIVERSE.religious_ethos, facetBags.religious_ethos)
  var section41Counts = withZeros(FACET_UNIVERSE.section_41, facetBags.section_41)
  var boardingCounts = withZeros(FACET_UNIVERSE.boarding, facetBags.boarding)
  var nurseryCounts = withZeros(FACET_UNIVERSE.nursery_provision, facetBags.nursery_provision)
  var sixthFormCounts = withZeros(FACET_UNIVERSE.sixth_form, facetBags.sixth_form)
  var admissionsCounts = withZeros(FACET_UNIVERSE.admissions_policy, facetBags.admissions_policy)
  var specialClassesCounts = withZeros(FACET_UNIVERSE.special_classes, facetBags.special_classes)
  var resourcedCounts = withZeros(FACET_UNIVERSE.resourced_provision, facetBags.resourced_provision)
  var feTypeCounts = withZeros(FACET_UNIVERSE.fe_type, facetBags.fe_type)
  var senTypeCounts = withZeros(FACET_UNIVERSE.sen_type, facetBags.sen_type)
  // Provider type: groups and their types, flattened for the unticking check.
  var typeGroupCounts = withZeros(FACET_UNIVERSE.type.groups, facetBags.type.groups)
  var typeDetailCounts = {}
  var typeDetailFlat = {}
  Object.keys(FACET_UNIVERSE.type.details).forEach(function (g) {
    typeDetailCounts[g] = withZeros(FACET_UNIVERSE.type.details[g], facetBags.type.details[g] || {})
    Object.keys(typeDetailCounts[g]).forEach(function (c) { typeDetailFlat[c] = typeDetailCounts[g][c] })
  })

  // A ticked option with no matches is unticked, as long as another ticked
  // option in the same filter does have matches: the results do not change, and
  // the filter tags and links stay honest. If nothing ticked in a filter has
  // matches the selection stays, because unticking would widen an empty search
  // into different results.
  ;[
    ['status', function () { return activeStatuses }, function (v) { activeStatuses = v }, statusCounts],
    ['type', function () { return activeTypes }, function (v) { activeTypes = v }, typeDetailFlat],
    ['group_type', function () { return activeGroupTypes }, function (v) { activeGroupTypes = v }, groupTypeCounts],
    ['region', function () { return activeRegions }, function (v) { activeRegions = v }, regionCounts],
    ['phase', function () { return activePhases }, function (v) { activePhases = v }, phaseCounts],
    ['gender', function () { return activeGenders }, function (v) { activeGenders = v }, genderCounts],
    ['religious_character', function () { return activeReligions }, function (v) { activeReligions = v }, religionCounts],
    ['religious_ethos', function () { return activeEthos }, function (v) { activeEthos = v }, ethosCounts],
    ['section_41', function () { return activeSection41 }, function (v) { activeSection41 = v }, section41Counts],
    ['boarding', function () { return activeBoarding }, function (v) { activeBoarding = v }, boardingCounts],
    ['nursery_provision', function () { return activeNursery }, function (v) { activeNursery = v }, nurseryCounts],
    ['sixth_form', function () { return activeSixthForm }, function (v) { activeSixthForm = v }, sixthFormCounts],
    ['admissions_policy', function () { return activeAdmissions }, function (v) { activeAdmissions = v }, admissionsCounts],
    ['special_classes', function () { return activeSpecialClasses }, function (v) { activeSpecialClasses = v }, specialClassesCounts],
    ['resourced_provision', function () { return activeResourced }, function (v) { activeResourced = v }, resourcedCounts],
    ['fe_type', function () { return activeFeTypes }, function (v) { activeFeTypes = v }, feTypeCounts],
    ['sen_type', function () { return activeSenTypes }, function (v) { activeSenTypes = v }, senTypeCounts]
  ].forEach(function (f) {
    var active = f[1]()
    var hasMatches = function (v) { return (f[3][v] || 0) > 0 }
    if (active.some(hasMatches) && !active.every(hasMatches)) {
      var kept = active.filter(hasMatches)
      f[2](kept)
      effQuery[f[0]] = kept.slice()
    }
  })

  // Sort by name (A–Z or Z–A)
  filteredResults.sort(function (a, b) {
    var nameA = a.name.replace(/^[^a-zA-Z0-9]+/, '')
    var nameB = b.name.replace(/^[^a-zA-Z0-9]+/, '')
    var cmp = nameA.localeCompare(nameB)
    return sortOrder === 'za' ? -cmp : cmp
  })

  var totalResults = filteredResults.length

  // Live CSV of everything matching the current search and filters.
  if (req.query.download === 'csv') {
    return sendCsv(res, 'search-results.csv', filteredResults)
  }

  // A search that finds exactly one record goes straight to that record. Only
  // for a fresh search: once people apply filters they stay on the results.
  var NON_FILTER_KEYS = ['what', 'where', 'id', 'kind', 'include_closed', 'sort', 'page']
  var appliedFilterKeys = Object.keys(req.query).filter(function (k) { return NON_FILTER_KEYS.indexOf(k) === -1 })
  if (totalResults === 1 && appliedFilterKeys.length === 0 && (hasQ || hasWhere || exactId)) {
    return res.redirect('/establishment/' + encodeURIComponent(filteredResults[0].id) + '?from=' + encodeURIComponent('/home'))
  }
  var totalPages = Math.ceil(totalResults / RESULTS_PER_PAGE) || 1

  if (currentPage < 1) currentPage = 1
  if (currentPage > totalPages) currentPage = totalPages

  var startIndex = (currentPage - 1) * RESULTS_PER_PAGE
  var pageResults = filteredResults.slice(startIndex, startIndex + RESULTS_PER_PAGE)

  // Add member counts for groups
  pageResults = pageResults.map(function (item) {
    if (item.id_type === 'UID' || item.id_type === 'Group UID') {
      var memberCount = giasData.filter(function (school) {
        return isMemberOf(school, item.id)
      }).length
      // The GIAS links files are the authoritative record of membership, so an
      // absence of link rows means the group genuinely has no members — most
      // often because it has closed. Fall back to the part_of count only where
      // links have nothing but the prototype still holds members, so the count
      // can't contradict the members listed on the group's own page.
      var displayCount = item.member_count || memberCount || 0
      // The row label depends on what the group contains. Single-academy trusts
      // hold one academy by definition, so they get no row at all.
      var memberLabel = null
      if (item.type === 'Trust: Multi-academy') memberLabel = 'Number of academies'
      else if (item.type === 'Federation' || item.type === 'Shared foundation trust') memberLabel = 'Number of providers'
      else if (item.type === "Children's Centres Group" || item.type === "Children's Centres Collaboration") memberLabel = 'Number of centres'
      return Object.assign({}, item, {
        memberCount: memberCount,
        memberLabel: memberLabel,
        memberValue: memberLabel ? displayCount : null
      })
    }
    return item
  })

  // Pagination items
  var paginationItems = []
  if (totalPages > 1) {
    for (var i = 1; i <= totalPages; i++) {
      var showPage = (
        i === 1 ||
        i === totalPages ||
        i === currentPage ||
        i === currentPage - 1 ||
        i === currentPage + 1
      )
      if (showPage) {
        paginationItems.push({
          number: i,
          current: i === currentPage,
          href: buildPageUrl(effReq, i)
        })
      } else if (
        paginationItems.length > 0 &&
        !paginationItems[paginationItems.length - 1].ellipsis
      ) {
        paginationItems.push({ ellipsis: true })
      }
    }
  }

  // Build filter option lists
  var typeOptions = Object.keys(typeCounts).sort().map(function (type) {
    return {
      value: type,
      text: type,
      checked: activeTypes.indexOf(type) !== -1
    }
  })

  // All the statuses are always listed, in a fixed order.
  var STATUS_ORDER = ['Open', 'Closed', 'Proposed to open', 'Open, but proposed to close']
  Object.keys(statusCounts).forEach(function (st) { if (STATUS_ORDER.indexOf(st) === -1) STATUS_ORDER.push(st) })
  var statusOptions = finishOptions(STATUS_ORDER.map(function (status) {
    return { value: status, text: status, checked: activeStatuses.indexOf(status) !== -1 }
  }), statusCounts)

  var groupTypeOptions = Object.keys(groupTypeCounts).sort().map(function (type) {
    return {
      value: type,
      text: type,
      checked: activeGroupTypes.indexOf(type) !== -1
    }
  })
  groupTypeOptions = finishOptions(groupTypeOptions, groupTypeCounts)

  // Whether the *displayed* results contain providers and/or groups. Based on
  // the filtered set (after kind and the Group type facet are applied), not the
  // pre-filter search set — so browsing or filtering down to groups hides the
  // provider facets and leaves only Group type. The filter sidebar shows
  // provider facets only when providers are present, and the Group type facet
  // only when groups are present.
  // When the filters leave no results, fall back to the search results so the
  // filters stay on the page and can be changed or unticked.
  var facetBasis = filteredResults.length > 0 ? filteredResults : searchResults
  var hasProviders = facetBasis.some(function (x) { return x.id_type === 'URN' })
  var hasGroups = facetBasis.some(function (x) { return x.id_type === 'UID' || x.id_type === 'Group UID' })

  var laOptions = Object.keys(laCounts).sort().map(function (la) {
    return {
      value: la,
      text: la,
      checked: activeLAs.indexOf(la) !== -1
    }
  })

  var senOptions = [
    {
      value: 'true',
      text: 'Yes',
      checked: activeSen.indexOf('true') !== -1
    },
    {
      value: 'false',
      text: 'No',
      checked: activeSen.indexOf('false') !== -1
    }
  ]

  function buildOptions (counts, active) {
    return Object.keys(counts).sort().map(function (key) {
      return {
        value: key,
        text: key,
        checked: active.indexOf(key) !== -1
      }
    })
  }

  var phaseOptions = buildOptions(phaseCounts, activePhases)
  // Regions run north to south rather than A to Z, with Wales and the
  // non-regional values last.
  var regionLabels = { 'Not recorded': 'No region recorded' }
  var regionOptions = buildOptions(regionCounts, activeRegions)
  var genderOptions = buildOptions(genderCounts, activeGenders)
  var religionOptions = buildOptions(religionCounts, activeReligions)
  var ethosOptions = buildOptions(ethosCounts, activeEthos)
  var dioceseOptions = buildOptions(dioceseCounts, activeDioceses)
  var section41Options = buildOptions(section41Counts, activeSection41)

  // Ordered options: `order` lists values in display order; anything present in
  // the data but not listed is appended alphabetically. Values with no records
  // are omitted so the filter never shows an empty option. `labels` optionally
  // maps a raw data value to friendlier display text (the submitted value stays
  // the raw one, so no data migration is needed).
  function orderedOptions (counts, active, order, labels) {
    labels = labels || {}
    var seen = {}
    var out = []
    function label (val) { return labels[val] || val }
    order.forEach(function (val) {
      if (Object.prototype.hasOwnProperty.call(counts, val)) {
        out.push({ value: val, text: label(val), checked: active.indexOf(val) !== -1 })
        seen[val] = true
      }
    })
    Object.keys(counts).sort().forEach(function (val) {
      if (!seen[val]) out.push({ value: val, text: label(val), checked: active.indexOf(val) !== -1 })
    })
    return out
  }

  // Phase of education: keep the two "Middle deemed" values distinct in the
  // data, but show them with clearer labels.
  var phaseLabels = {
    'Middle deemed primary': 'Middle (Primary)',
    'Middle deemed secondary': 'Middle (Secondary)',
    'Not recorded': 'No phase of education recorded'
  }
  phaseOptions = orderedOptions(phaseCounts, activePhases, [
    'Nursery',
    'Primary',
    'Middle deemed primary',
    'Middle deemed secondary',
    'Secondary',
    '16 plus',
    'All-through',
    'Not applicable',
    'Not recorded'
  ], phaseLabels)

  // "Not recorded" is stored once but labelled per field, so each filter says
  // what is actually missing. The submitted value stays 'Not recorded'.
  var boardingLabels = { 'Not recorded': 'No boarding provision recorded' }
  var nurseryLabels = { 'Not recorded': 'No nursery provision recorded' }
  var sixthFormLabels = { 'Not recorded': 'No sixth form provision recorded' }
  var admissionsLabels = { 'Not recorded': 'No admissions policy recorded' }
  var specialClassesLabels = { 'Not recorded': 'No special classes recorded' }
  var senTypeLabels = { 'Not recorded': 'No type of SEN provision recorded' }
  var resourcedLabels = { 'Not recorded': 'No resourced provision recorded' }
  var resourcedOptions = orderedOptions(resourcedCounts, activeResourced, ['Resourced provision', 'SEN unit', 'Resourced provision and SEN unit', 'Not applicable', 'Not recorded'], resourcedLabels)

  var boardingOptions = orderedOptions(boardingCounts, activeBoarding, ['Boarding school', 'No boarders', 'Not applicable', 'Not recorded'], boardingLabels)
  var nurseryOptions = orderedOptions(nurseryCounts, activeNursery, ['Has nursery classes', 'No nursery classes', 'Not applicable', 'Not recorded'], nurseryLabels)
  var sixthFormOptions = orderedOptions(sixthFormCounts, activeSixthForm, ['Has a sixth form', 'Does not have a sixth form', 'Not applicable', 'Not recorded'], sixthFormLabels)
  var admissionsOptions = orderedOptions(admissionsCounts, activeAdmissions, ['Non-selective', 'Selective', 'Not applicable', 'Not recorded'], admissionsLabels)
  var specialClassesOptions = orderedOptions(specialClassesCounts, activeSpecialClasses, ['Has special classes', 'No special classes', 'Not applicable', 'Not recorded'], specialClassesLabels)
  // Revised SEN provision list order (as agreed). Values with no records are
  // omitted by orderedOptions, so e.g. ADHD only appears once data supplies it.
  var feTypeOptions = orderedOptions(feTypeCounts, activeFeTypes, [])

  // Provider type accordion structure: ordered parent groups, each holding its
  // child types. Only populated groups/children appear. `anyChecked` lets the
  // view open a group when one of its children is active.
  var typeGroupOrder = [
    'Academies',
    'Local authority maintained schools',
    'Free Schools',
    'Independent schools',
    'Special schools',
    'Colleges',
    "Children's Centres",
    'Other types',
    'Universities',
    'Welsh schools',
    'Online provider'
  ]
  var providerTypeGroups = []
  // Any group present in the data but missing from the order list is appended,
  // so a new GIAS group can never silently vanish from the filter. A group with
  // no matching types is shown as plain text; within a group, a type with no
  // matches is plain text with no checkbox (unless it is ticked).
  var allGroupNames = typeGroupOrder.filter(function (g) { return typeGroupCounts[g] !== undefined })
  Object.keys(typeGroupCounts).sort().forEach(function (g) { if (allGroupNames.indexOf(g) === -1) allGroupNames.push(g) })
  allGroupNames.forEach(function (groupName) {
    var childCounts = typeDetailCounts[groupName] || {}
    var children = finishOptions(Object.keys(childCounts).sort().map(function (child) {
      return { value: child, text: child, checked: activeTypes.indexOf(child) !== -1 }
    }), childCounts)
    if (children.length === 0) return
    var live = children.filter(function (c) { return !c.disabled })
    providerTypeGroups.push({
      name: groupName,
      count: typeGroupCounts[groupName],
      children: children,
      unavailable: live.length === 0,
      anyChecked: live.some(function (c) { return c.checked }),
      allChecked: live.length > 0 && live.every(function (c) { return c.checked })
    })
  })

  var senTypeOptions = orderedOptions(senTypeCounts, activeSenTypes, [
    'ADHD',
    'Autistic Spectrum Condition',
    'Impairment (hearing)',
    'Impairment (multi-sensory)',
    'Impairment (visual)',
    'Learning difficulty (moderate)',
    'Learning difficulty (profound and multiple)',
    'Learning difficulty (severe)',
    'Learning difficulty (specific)',
    'Other difficulty / disability',
    'Physical disability',
    'Social, emotional and mental health',
    'Speech, language and communication',
    'Not applicable',
    'Not recorded'
  ], senTypeLabels)

  regionOptions = orderedOptions(regionCounts, activeRegions, [
    'North East',
    'North West',
    'Yorkshire and the Humber',
    'East Midlands',
    'West Midlands',
    'East of England',
    'London',
    'South East',
    'South West',
    'Wales',
    'Not applicable',
    'Not recorded'
  ], regionLabels)

  regionOptions = finishOptions(regionOptions, regionCounts)
  phaseOptions = finishOptions(phaseOptions, phaseCounts)
  genderOptions = finishOptions(genderOptions, genderCounts)
  religionOptions = finishOptions(religionOptions, religionCounts)
  ethosOptions = finishOptions(ethosOptions, ethosCounts)
  section41Options = finishOptions(section41Options, section41Counts)
  boardingOptions = finishOptions(boardingOptions, boardingCounts)
  nurseryOptions = finishOptions(nurseryOptions, nurseryCounts)
  sixthFormOptions = finishOptions(sixthFormOptions, sixthFormCounts)
  admissionsOptions = finishOptions(admissionsOptions, admissionsCounts)
  specialClassesOptions = finishOptions(specialClassesOptions, specialClassesCounts)
  resourcedOptions = finishOptions(resourcedOptions, resourcedCounts)
  feTypeOptions = finishOptions(feTypeOptions, feTypeCounts)
  senTypeOptions = finishOptions(senTypeOptions, senTypeCounts)

  // Build selected filter tags
  var selectedCategories = []

  if (activeStatuses.length > 0) {
    selectedCategories.push({
      heading: { text: 'Operating status' },
      items: activeStatuses.map(function (val) {
        return { text: val, href: buildRemoveFilterUrl(effReq, 'status', val) }
      })
    })
  }

  if (activeLAs.length > 0) {
    selectedCategories.push({
      heading: { text: 'Local authority' },
      items: activeLAs.map(function (val) {
        return { text: val, href: buildRemoveFilterUrl(effReq, 'local_authority', val) }
      })
    })
  }

  function tagCategory (label, key, active, valueLabels) {
    if (active.length > 0) {
      selectedCategories.push({
        heading: { text: label },
        items: active.map(function (val) {
          return { text: (valueLabels && valueLabels[val]) || val, href: buildRemoveFilterUrl(effReq, key, val) }
        })
      })
    }
  }

  // Provider type tags. When every child type in a group is selected, show one
  // tag for the group (removing it clears all of that group's children) rather
  // than listing each child. Partly-selected groups list their children.
  if (activeTypes.length > 0) {
    var typeTagItems = []
    var accountedFor = {}
    providerTypeGroups.forEach(function (group) {
      if (!group.allChecked) return
      group.children.forEach(function (c) { accountedFor[c.value] = true })
      typeTagItems.push({
        text: group.name,
        href: buildRemoveKeysValuesUrl(effReq, 'type', group.children.map(function (c) { return c.value }))
      })
    })
    activeTypes.forEach(function (val) {
      if (accountedFor[val]) return
      typeTagItems.push({ text: val, href: buildRemoveFilterUrl(effReq, 'type', val) })
    })
    if (typeTagItems.length > 0) {
      selectedCategories.push({
        heading: { text: 'Education provider type' },
        items: typeTagItems
      })
    }
  }
  tagCategory('Education group type', 'group_type', activeGroupTypes)
  tagCategory('Region', 'region', activeRegions, regionLabels)
  tagCategory('Phase of education', 'phase', activePhases, phaseLabels)
  tagCategory('Gender', 'gender', activeGenders)
  tagCategory('Religious character', 'religious_character', activeReligions)
  tagCategory('Religious ethos', 'religious_ethos', activeEthos)
  tagCategory('Diocese', 'diocese', activeDioceses)
  tagCategory('Section 41 (approved for SEND provision)', 'section_41', activeSection41)
  tagCategory('Boarding provision', 'boarding', activeBoarding, boardingLabels)
  tagCategory('Nursery provision', 'nursery_provision', activeNursery, nurseryLabels)
  tagCategory('Sixth form provision', 'sixth_form', activeSixthForm, sixthFormLabels)
  tagCategory('Admissions policy', 'admissions_policy', activeAdmissions, admissionsLabels)
  tagCategory('Special classes', 'special_classes', activeSpecialClasses, specialClassesLabels)
  tagCategory('Type of SEN provision', 'sen_type', activeSenTypes, senTypeLabels)
  tagCategory('Further education type', 'fe_type', activeFeTypes)
  tagCategory('Resourced provision', 'resourced_provision', activeResourced, resourcedLabels)

  // Age range shows as a single removable tag covering both bounds.
  if (ageFrom !== null || ageTo !== null) {
    var ageText = ageFrom !== null && ageTo !== null
      ? ageFrom + ' to ' + ageTo
      : (ageFrom !== null ? ageFrom + ' and over' : 'up to ' + ageTo)
    selectedCategories.push({
      heading: { text: 'Age range' },
      items: [{ text: ageText, href: buildRemoveKeysUrl(effReq, ['age_from', 'age_to']) }]
    })
  }

  // Date ranges show as a single removable tag per filter.
  var MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  function partsText (p) {
    if (!p) return null
    var mi = parseInt(p.m, 10)
    // Dates read as "1 July 2025", "July 2025" or "2025".
    if (!p.m || isNaN(mi) || mi < 1 || mi > 12) return [p.d, p.m, p.y].filter(Boolean).join('/')
    return [p.d ? String(parseInt(p.d, 10)) : '', MONTHS[mi], p.y].filter(Boolean).join(' ')
  }
  function tagDateRange (label, prefix, from, to) {
    if (!from && !to) return
    var f = partsText(from)
    var t = partsText(to)
    var text = f && t ? f + ' to ' + t : (f ? 'from ' + f : 'up to ' + t)
    selectedCategories.push({
      heading: { text: label },
      items: [{
        text: text,
        href: buildRemoveKeysUrl(effReq, [
          prefix + '_from_day', prefix + '_from_month', prefix + '_from_year',
          prefix + '_to_day', prefix + '_to_month', prefix + '_to_year'
        ])
      }]
    })
  }
  tagDateRange('Open date', 'open', openFrom, openTo)
  tagDateRange('Closed date', 'close', closeFrom, closeTo)

  var hasActiveFilters = selectedCategories.length > 0

  res.render('results', {
    results: pageResults,
    query: q || exactId,
    totalResults: totalResults,
    currentPage: currentPage,
    totalPages: totalPages,
    paginationItems: paginationItems,
    prevHref: currentPage > 1 ? buildPageUrl(effReq, currentPage - 1) : null,
    nextHref: currentPage < totalPages ? buildPageUrl(effReq, currentPage + 1) : null,
    typeOptions: typeOptions,
    statusOptions: statusOptions,
    groupTypeOptions: groupTypeOptions,
    hasProviders: hasProviders,
    hasGroups: hasGroups,
    laOptions: laOptions,
    senOptions: senOptions,
    regionOptions: regionOptions,
    phaseOptions: phaseOptions,
    genderOptions: genderOptions,
    religionOptions: religionOptions,
    ethosOptions: ethosOptions,
    dioceseOptions: dioceseOptions,
    section41Options: section41Options,
    boardingOptions: boardingOptions,
    nurseryOptions: nurseryOptions,
    sixthFormOptions: sixthFormOptions,
    admissionsOptions: admissionsOptions,
    specialClassesOptions: specialClassesOptions,
    senTypeOptions: senTypeOptions,
    feTypeOptions: feTypeOptions,
    resourcedOptions: resourcedOptions,
    downloadHref: buildDownloadUrl(effReq),
    providerTypeGroups: providerTypeGroups,
    ageFrom: req.query.age_from || '',
    ageTo: req.query.age_to || '',
    openFromParts: openFrom,
    openToParts: openTo,
    closeFromParts: closeFrom,
    closeToParts: closeTo,
    allLocalAuthorities: allLocalAuthorities,
    allDioceses: allDioceses,
    activeLAs: activeLAs,
    activeDioceses: activeDioceses,
    sortOrder: sortOrder,
    kind: kind,
          // The record type links only help when both kinds have results. The one exception: viewing a kind with no results while the other has some, where hiding them would leave no way back.
    showKindNav: (kindCounts.provider > 0 && kindCounts.group > 0) ||
      (kind !== null && kindCounts.all > 0 && filteredResults.length === 0),
    kindNavItems: [
      { text: 'All search results', href: buildKindUrl(effReq, null), active: !kind },
      { text: 'Education providers (' + kindCounts.provider.toLocaleString('en-GB') + ')', href: buildKindUrl(effReq, 'provider'), active: kind === 'provider' },
      { text: 'Education provider groups (' + kindCounts.group.toLocaleString('en-GB') + ')', href: buildKindUrl(effReq, 'group'), active: kind === 'group' }
    ],
    includeClosed: includeClosed,
    selectedCategories: selectedCategories,
    hasActiveFilters: hasActiveFilters,
    clearFiltersHref: buildClearFiltersUrl(effReq),
    searchQ: q,
    searchWhere: where,
    searchId: exactId,
    currentUrl: req.originalUrl
  })
})


// Individual school/group detail page
router.get('/establishment/:id', function (req, res) {
  // Search all data including closed establishments
  var id = req.params.id
  var item = giasData.find(function (item) {
    return item.id === id
  })

  if (!item) {
    return res.status(404).render('404')
  }

  // If it's a group, find all member schools
  var members = []
  if (item.id_type === 'UID' || item.id_type === 'Group UID') {
    members = giasData.filter(function (school) {
      return isMemberOf(school, id)
    })
  }

  // Group members by phase of education for the Academies tab. Sections are
  // shown in education order; any member without a recognised phase (including
  // "Not applicable" and blanks) falls under "Other". Members are listed
  // alphabetically within each section.
  var PHASE_ORDER = [
    'Nursery',
    'Primary',
    'Middle deemed primary',
    'Middle deemed secondary',
    'Secondary',
    'All-through',
    '16 plus'
  ]
  var membersByPhase = []
  if (members.length > 0) {
    var phaseBuckets = {}
    members.forEach(function (m) {
      var label = PHASE_ORDER.indexOf(m.phase) !== -1 ? m.phase : 'Other'
      if (!phaseBuckets[label]) phaseBuckets[label] = []
      phaseBuckets[label].push(m)
    })
    PHASE_ORDER.concat(['Other']).forEach(function (label) {
      if (phaseBuckets[label]) {
        phaseBuckets[label].sort(function (a, b) {
          return (a.name || '').localeCompare(b.name || '')
        })
        membersByPhase.push({ phase: label, members: phaseBuckets[label] })
      }
    })
  }

  // Official predecessor and successor links (History tab)
  // Each linked record's own closed date comes from the register.
  var historyLinks = linksData[id] || { predecessors: [], successors: [], other: [] }
  function withClosedDate (link) {
    var rec = urnIndex.get(link.id)
    return Object.assign({}, link, rec ? { status: rec.status, close_date: rec.close_date } : {})
  }
  var historyPredecessors = historyLinks.predecessors.map(withClosedDate)
  var historySuccessors = historyLinks.successors.map(withClosedDate)

  // Governance record (governors for providers; trustees + members for groups)
  var governance = governanceData[id] || null

  // Build "left within the last 12 months" lists from the full governance
  // arrays. A person counts as a recent leaver if they are no longer current
  // and their term end date falls within the last 12 months.
  if (governance) {
    var govNow = new Date()
    var govCutoff = new Date()
    govCutoff.setFullYear(govCutoff.getFullYear() - 1)

    var parseDmy = function (s) {
      if (!s) return null
      var parts = s.split('/')
      if (parts.length !== 3) return null
      var d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]))
      return isNaN(d.getTime()) ? null : d
    }

    var recentLeavers = function (list) {
      return (list || []).filter(function (g) {
        if (g.current) return false
        var ended = parseDmy(g.term_ends)
        return ended && ended >= govCutoff && ended <= govNow
      }).sort(function (a, b) {
        return parseDmy(b.term_ends) - parseDmy(a.term_ends)
      })
    }

    governance.governors_left_recent = recentLeavers(governance.governors)
    governance.trustees_left_recent = recentLeavers(governance.trustees)
    governance.members_left_recent = recentLeavers(governance.members)
  }

  res.render('establishment', {
    item: item,
    members: members,
    membersByPhase: membersByPhase,
    predecessors: historyPredecessors,
    successors: historySuccessors,
    governance: governance,
    backLink: req.query.from || '/results'
  })
})

// View all establishments
router.get('/all', function (req, res) {
  res.redirect('/results?what=*')
})


function buildPageUrl (req, page) {
  var params = Object.assign({}, req.query, { page: page })
  var qs = Object.keys(params).map(function (k) {
    return [].concat(params[k]).filter(function (v) {
      return v !== '_unchecked'
    }).map(function (v) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(v)
    }).join('&')
  }).filter(Boolean).join('&')
  return '/results?' + qs
}


// Remove several values from a single filter key at once — used where one tag
// stands for a set of selections (e.g. a fully-selected provider type group).
function buildRemoveKeysValuesUrl (req, filterKey, valuesToRemove) {
  var params = Object.assign({}, req.query)
  var remaining = [].concat(params[filterKey] || []).filter(function (v) {
    return v !== '_unchecked' && valuesToRemove.indexOf(v) === -1
  })
  if (remaining.length > 0) {
    params[filterKey] = remaining
  } else if (filterKey === 'status') {
    params[filterKey] = '_all'
  } else {
    delete params[filterKey]
  }
  delete params.page
  var qs = Object.keys(params).map(function (k) {
    return [].concat(params[k]).filter(function (v) {
      return v !== '_unchecked'
    }).map(function (v) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(v)
    }).join('&')
  }).filter(Boolean).join('&')
  return '/results?' + qs
}

// Remove a whole set of query keys at once — used by range filters where the
// tag represents several params (e.g. age_from + age_to).
function buildRemoveKeysUrl (req, keys) {
  var params = Object.assign({}, req.query)
  keys.forEach(function (k) { delete params[k] })
  delete params.page
  var qs = Object.keys(params).map(function (k) {
    return [].concat(params[k]).filter(function (v) {
      return v !== '_unchecked'
    }).map(function (v) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(v)
    }).join('&')
  }).filter(Boolean).join('&')
  return '/results?' + qs
}

function buildRemoveFilterUrl (req, filterKey, filterValue) {
  var params = Object.assign({}, req.query)
  var values = [].concat(params[filterKey] || []).filter(function (v) {
    return v !== filterValue && v !== '_unchecked'
  })
  if (values.length > 0) {
    params[filterKey] = values
  } else if (filterKey === 'status') {
    // Removing the last operating status must not fall back to the default.
    params[filterKey] = '_all'
  } else {
    delete params[filterKey]
  }
  delete params.page
  var qs = Object.keys(params).map(function (k) {
    return [].concat(params[k]).filter(function (v) {
      return v !== '_unchecked'
    }).map(function (v) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(v)
    }).join('&')
  }).filter(Boolean).join('&')
  return '/results?' + qs
}


// Parse a day-first GIAS date ('DD-MM-YYYY' or 'DD/MM/YYYY') to a sortable
// YYYYMMDD integer, or null if unparseable.
function toYmd (dateStr) {
  if (!dateStr) return null
  var m = String(dateStr).trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (!m) return null
  return parseInt(m[3] + m[2].padStart(2, '0') + m[1].padStart(2, '0'), 10)
}

// Convert a {y,m,d} bound to a YYYYMMDD integer. `isTo` fills missing month/day
// with the upper boundary (12/31) so a year-only 'To' includes the whole year.
function boundToYmd (bound, isTo) {
  if (!bound) return null
  var y = bound.y
  if (!y) return null
  var m = bound.m || (isTo ? '12' : '01')
  var d = bound.d || (isTo ? '31' : '01')
  return parseInt(y + m.padStart(2, '0') + d.padStart(2, '0'), 10)
}

// True if a record date falls within [from,to] (either side may be null).
// A null record date passes only when no bound is set on that filter.
function dateInRange (dateStr, from, to) {
  var lo = boundToYmd(from, false)
  var hi = boundToYmd(to, true)
  if (lo === null && hi === null) return true
  var val = toYmd(dateStr)
  if (val === null) return false
  if (lo !== null && val < lo) return false
  if (hi !== null && val > hi) return false
  return true
}

function buildDownloadUrl (req) {
  var params = Object.assign({}, req.query, { download: 'csv' })
  delete params.page
  var qs = Object.keys(params).map(function (k) {
    return [].concat(params[k]).filter(function (v) {
      return v !== '_unchecked'
    }).map(function (v) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(v)
    }).join('&')
  }).filter(Boolean).join('&')
  return '/results?' + qs
}

// The results URL with the record kind swapped, keeping the search and every
// filter. Paging resets, because the result set changes.
function buildKindUrl (req, kind) {
  var parts = []
  Object.keys(req.query).forEach(function (k) {
    if (k === 'kind' || k === 'page') return
    ;[].concat(req.query[k]).forEach(function (v) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v))
    })
  })
  if (kind) parts.push('kind=' + kind)
  return '/results' + (parts.length ? '?' + parts.join('&') : '')
}

function buildClearFiltersUrl (req) {
  var params = {}
  if (req.query.what) params.what = req.query.what
  if (req.query.where) params.where = req.query.where
  if (req.query.id) params.id = req.query.id
  // Keep the search-panel "Include closed" toggle; it isn't a sidebar filter.
  if (req.query.include_closed) params.include_closed = req.query.include_closed
  var qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
  }).join('&')
  return '/results?' + qs
}


