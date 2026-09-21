//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()
const giasData = require('./data/gias_prototype.json')
const predecessorsData = require('./data/predecessors.json')
const governanceData = require('./data/governance.json')

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

// Build a set of closed establishment IDs that have been matched as predecessors.
// (Retained only for the establishment History tab; no longer used to filter search.)
const matchedPredecessorIds = new Set()
Object.values(predecessorsData).forEach(function (preds) {
  preds.forEach(function (p) {
    matchedPredecessorIds.add(p.id)
  })
})

// Search runs against the full dataset (open and closed). Whether closed
// records appear is controlled at request time by the "Show open providers
// only" toggle and the Status filter — not by pre-splitting the data.
const allData = giasData

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
  var activeStatuses = [].concat(req.query.status || []).filter(function (v) { return v !== '_unchecked' })
  var activeLAs = [].concat(req.query.local_authority || []).filter(function (v) { return v !== '_unchecked' })
  var activeSen = [].concat(req.query.sen_provision || []).filter(function (v) { return v !== '_unchecked' })
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

  // Status is an explicit filter only. Search returns records of all statuses
  // (Open, Closed, Proposed to open, etc.) unless the user ticks specific
  // statuses in the Status filter. There is no "open only" default.

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

  // Calculate counts from full search results (before filtering)
  var typeCounts = {}
  var statusCounts = {}
  var laCounts = {}
  var senCounts = { 'true': 0, 'false': 0 }
  var phaseCounts = {}
  var genderCounts = {}
  var religionCounts = {}
  var ethosCounts = {}
  var dioceseCounts = {}
  var section41Counts = {}
  var boardingCounts = {}
  var nurseryCounts = {}
  var sixthFormCounts = {}
  var admissionsCounts = {}
  var specialClassesCounts = {}
  var senTypeCounts = {}
  var feTypeCounts = {}
  var typeGroupCounts = {}
  var typeDetailCounts = {}

  // Count a value, treating null/empty as "Not recorded" so the filter can
  // offer that as an explicit option.
  function bump (obj, key) {
    if (key === null || key === undefined || key === '') key = 'Not recorded'
    obj[key] = (obj[key] || 0) + 1
  }

  searchResults.forEach(function (item) {
    if (item.type) typeCounts[item.type] = (typeCounts[item.type] || 0) + 1
    if (item.status) statusCounts[item.status] = (statusCounts[item.status] || 0) + 1
    if (item.local_authority) laCounts[item.local_authority] = (laCounts[item.local_authority] || 0) + 1
    var senKey = item.sen_provision ? 'true' : 'false'
    senCounts[senKey]++
    if (item.phase) phaseCounts[item.phase] = (phaseCounts[item.phase] || 0) + 1
    if (item.gender) genderCounts[item.gender] = (genderCounts[item.gender] || 0) + 1
    if (item.religious_character) religionCounts[item.religious_character] = (religionCounts[item.religious_character] || 0) + 1
    if (item.religious_ethos) ethosCounts[item.religious_ethos] = (ethosCounts[item.religious_ethos] || 0) + 1
    if (item.diocese) dioceseCounts[item.diocese] = (dioceseCounts[item.diocese] || 0) + 1
    if (item.section_41) section41Counts[item.section_41] = (section41Counts[item.section_41] || 0) + 1
    // Provider-only facets
    if (item.id_type === 'URN') {
      bump(boardingCounts, item.boarding)
      bump(nurseryCounts, item.nursery_provision)
      bump(sixthFormCounts, item.sixth_form)
      bump(admissionsCounts, item.admissions_policy)
      bump(specialClassesCounts, item.special_classes)
      if (item.fe_type) feTypeCounts[item.fe_type] = (feTypeCounts[item.fe_type] || 0) + 1
      if (item.type_group) {
        typeGroupCounts[item.type_group] = (typeGroupCounts[item.type_group] || 0) + 1
        if (!typeDetailCounts[item.type_group]) typeDetailCounts[item.type_group] = {}
        if (item.type_detail) {
          typeDetailCounts[item.type_group][item.type_detail] = (typeDetailCounts[item.type_group][item.type_detail] || 0) + 1
        }
      }
      // sen_types is an array — a record can contribute to several options.
      // An empty array counts once as "Not recorded".
      var senTypes = item.sen_types || []
      if (senTypes.length === 0) {
        senTypeCounts['Not recorded'] = (senTypeCounts['Not recorded'] || 0) + 1
      } else {
        senTypes.forEach(function (t) {
          senTypeCounts[t] = (senTypeCounts[t] || 0) + 1
        })
      }
    }
  })

  // Apply filters
  var filteredResults = searchResults.filter(function (item) {
    // Record kind: provider = URN, group = UID / Group UID.
    if (kind === 'provider' && item.id_type !== 'URN') return false
    if (kind === 'group' && item.id_type !== 'UID' && item.id_type !== 'Group UID') return false
    // Status filter: only applies when the user has ticked one or more statuses.
    if (activeStatuses.length > 0 && activeStatuses.indexOf(item.status) === -1) {
      return false
    }
    // Provider type accordion filters on the detailed type (child checkboxes).
    if (activeTypes.length > 0 && activeTypes.indexOf(item.type_detail) === -1) return false
    if (activeLAs.length > 0 && activeLAs.indexOf(item.local_authority) === -1) return false
    if (activeSen.length > 0 && activeSen.indexOf(String(item.sen_provision)) === -1) return false
    if (activePhases.length > 0 && activePhases.indexOf(item.phase) === -1) return false
    if (activeGenders.length > 0 && activeGenders.indexOf(item.gender) === -1) return false
    if (activeReligions.length > 0 && activeReligions.indexOf(item.religious_character) === -1) return false
    if (activeEthos.length > 0 && activeEthos.indexOf(item.religious_ethos) === -1) return false
    if (activeDioceses.length > 0 && activeDioceses.indexOf(item.diocese) === -1) return false
    if (activeSection41.length > 0 && activeSection41.indexOf(item.section_41) === -1) return false

    // New categorical filters. "Not recorded" option matches null/empty fields.
    function catMatch (active, value) {
      if (active.length === 0) return true
      if (active.indexOf('Not recorded') !== -1 && (value === null || value === undefined || value === '')) return true
      return active.indexOf(value) !== -1
    }
    if (!catMatch(activeBoarding, item.boarding)) return false
    if (!catMatch(activeNursery, item.nursery_provision)) return false
    if (!catMatch(activeSixthForm, item.sixth_form)) return false
    if (!catMatch(activeAdmissions, item.admissions_policy)) return false
    if (!catMatch(activeSpecialClasses, item.special_classes)) return false
    if (!catMatch(activeFeTypes, item.fe_type)) return false

    // SEN type: item.sen_types is an array; match if any active type is present.
    if (activeSenTypes.length > 0) {
      var st = item.sen_types || []
      var hit = activeSenTypes.some(function (t) {
        if (t === 'Not recorded') return st.length === 0 || st.indexOf('Not recorded') !== -1
        return st.indexOf(t) !== -1
      })
      if (!hit) return false
    }

    // Age range: item covers ages age_low..age_high. Overlap test with From/To.
    if (ageFrom !== null && item.age_high !== null && item.age_high !== undefined && item.age_high < ageFrom) return false
    if (ageTo !== null && item.age_low !== null && item.age_low !== undefined && item.age_low > ageTo) return false

    // Date ranges (open_date / close_date are day-first strings)
    if (!dateInRange(item.open_date, openFrom, openTo)) return false
    if (!dateInRange(item.close_date, closeFrom, closeTo)) return false
    return true
  })

  // Sort by name (A–Z or Z–A)
  filteredResults.sort(function (a, b) {
    var nameA = a.name.replace(/^[^a-zA-Z0-9]+/, '')
    var nameB = b.name.replace(/^[^a-zA-Z0-9]+/, '')
    var cmp = nameA.localeCompare(nameB)
    return sortOrder === 'za' ? -cmp : cmp
  })

  var totalResults = filteredResults.length
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
          href: buildPageUrl(req, i)
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
      text: type + ' (' + typeCounts[type] + ')',
      checked: activeTypes.indexOf(type) !== -1
    }
  })

  var statusOptions = Object.keys(statusCounts).sort().map(function (status) {
    return {
      value: status,
      text: status + ' (' + statusCounts[status] + ')',
      checked: activeStatuses.indexOf(status) !== -1
    }
  })

  var laOptions = Object.keys(laCounts).sort().map(function (la) {
    return {
      value: la,
      text: la + ' (' + laCounts[la] + ')',
      checked: activeLAs.indexOf(la) !== -1
    }
  })

  var senOptions = [
    {
      value: 'true',
      text: 'Yes (' + senCounts['true'] + ')',
      checked: activeSen.indexOf('true') !== -1
    },
    {
      value: 'false',
      text: 'No (' + senCounts['false'] + ')',
      checked: activeSen.indexOf('false') !== -1
    }
  ]

  function buildOptions (counts, active) {
    return Object.keys(counts).sort().map(function (key) {
      return {
        value: key,
        text: key + ' (' + counts[key] + ')',
        checked: active.indexOf(key) !== -1
      }
    })
  }

  var phaseOptions = buildOptions(phaseCounts, activePhases)
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
      if (counts[val]) {
        out.push({ value: val, text: label(val) + ' (' + counts[val] + ')', checked: active.indexOf(val) !== -1 })
        seen[val] = true
      }
    })
    Object.keys(counts).sort().forEach(function (val) {
      if (!seen[val]) out.push({ value: val, text: label(val) + ' (' + counts[val] + ')', checked: active.indexOf(val) !== -1 })
    })
    return out
  }

  // Phase of education: keep the two "Middle deemed" values distinct in the
  // data, but show them with clearer labels.
  var phaseLabels = {
    'Middle deemed primary': 'Middle (Primary)',
    'Middle deemed secondary': 'Middle (Secondary)'
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

  var boardingOptions = orderedOptions(boardingCounts, activeBoarding, ['Boarding school', 'No boarders', 'Not applicable', 'Not recorded'])
  var nurseryOptions = orderedOptions(nurseryCounts, activeNursery, ['Has nursery classes', 'No nursery classes', 'Not applicable', 'Not recorded'])
  var sixthFormOptions = orderedOptions(sixthFormCounts, activeSixthForm, ['Has a sixth form', 'Does not have a sixth form', 'Not applicable', 'Not recorded'])
  var admissionsOptions = orderedOptions(admissionsCounts, activeAdmissions, ['Non-selective', 'Selective', 'Not applicable', 'Not recorded'])
  var specialClassesOptions = orderedOptions(specialClassesCounts, activeSpecialClasses, ['Has special classes', 'No special classes', 'Not applicable', 'Not recorded'])
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
  typeGroupOrder.forEach(function (groupName) {
    if (!typeGroupCounts[groupName]) return
    var childCounts = typeDetailCounts[groupName] || {}
    var children = Object.keys(childCounts).sort().map(function (child) {
      return {
        value: child,
        text: child + ' (' + childCounts[child] + ')',
        checked: activeTypes.indexOf(child) !== -1
      }
    })
    if (children.length === 0) return
    providerTypeGroups.push({
      name: groupName,
      count: typeGroupCounts[groupName],
      children: children,
      anyChecked: children.some(function (c) { return c.checked }),
      allChecked: children.every(function (c) { return c.checked })
    })
  })
  // Any group present in the data but missing from the order list is appended,
  // so a new GIAS group can never silently vanish from the filter.
  Object.keys(typeGroupCounts).sort().forEach(function (groupName) {
    if (typeGroupOrder.indexOf(groupName) !== -1) return
    var childCounts = typeDetailCounts[groupName] || {}
    var children = Object.keys(childCounts).sort().map(function (child) {
      return { value: child, text: child + ' (' + childCounts[child] + ')', checked: activeTypes.indexOf(child) !== -1 }
    })
    if (children.length === 0) return
    providerTypeGroups.push({
      name: groupName,
      count: typeGroupCounts[groupName],
      children: children,
      anyChecked: children.some(function (c) { return c.checked }),
      allChecked: children.every(function (c) { return c.checked })
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
  ])

  // Build selected filter tags
  var selectedCategories = []

  if (activeStatuses.length > 0) {
    selectedCategories.push({
      heading: { text: 'Status' },
      items: activeStatuses.map(function (val) {
        return { text: val, href: buildRemoveFilterUrl(req, 'status', val) }
      })
    })
  }

  if (activeLAs.length > 0) {
    selectedCategories.push({
      heading: { text: 'Local authority' },
      items: activeLAs.map(function (val) {
        return { text: val, href: buildRemoveFilterUrl(req, 'local_authority', val) }
      })
    })
  }

  function tagCategory (label, key, active, valueLabels) {
    if (active.length > 0) {
      selectedCategories.push({
        heading: { text: label },
        items: active.map(function (val) {
          return { text: (valueLabels && valueLabels[val]) || val, href: buildRemoveFilterUrl(req, key, val) }
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
        href: buildRemoveKeysValuesUrl(req, 'type', group.children.map(function (c) { return c.value }))
      })
    })
    activeTypes.forEach(function (val) {
      if (accountedFor[val]) return
      typeTagItems.push({ text: val, href: buildRemoveFilterUrl(req, 'type', val) })
    })
    if (typeTagItems.length > 0) {
      selectedCategories.push({
        heading: { text: 'Provider type' },
        items: typeTagItems
      })
    }
  }
  tagCategory('Phase of education', 'phase', activePhases, phaseLabels)
  tagCategory('Gender', 'gender', activeGenders)
  tagCategory('Religious character', 'religious_character', activeReligions)
  tagCategory('Religious ethos', 'religious_ethos', activeEthos)
  tagCategory('Diocese', 'diocese', activeDioceses)
  tagCategory('Section 41 approved', 'section_41', activeSection41)
  tagCategory('Boarding provision', 'boarding', activeBoarding)
  tagCategory('Nursery provision', 'nursery_provision', activeNursery)
  tagCategory('Sixth form provision', 'sixth_form', activeSixthForm)
  tagCategory('Admissions policy', 'admissions_policy', activeAdmissions)
  tagCategory('Special classes', 'special_classes', activeSpecialClasses)
  tagCategory('Type of SEN provision', 'sen_type', activeSenTypes)
  tagCategory('Further Education type', 'fe_type', activeFeTypes)

  // Age range shows as a single removable tag covering both bounds.
  if (ageFrom !== null || ageTo !== null) {
    var ageText = ageFrom !== null && ageTo !== null
      ? ageFrom + ' to ' + ageTo
      : (ageFrom !== null ? ageFrom + ' and over' : 'up to ' + ageTo)
    selectedCategories.push({
      heading: { text: 'Age range' },
      items: [{ text: ageText, href: buildRemoveKeysUrl(req, ['age_from', 'age_to']) }]
    })
  }

  // Date ranges show as a single removable tag per filter.
  function partsText (p) {
    if (!p) return null
    return [p.d, p.m, p.y].filter(Boolean).join('/')
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
        href: buildRemoveKeysUrl(req, [
          prefix + '_from_day', prefix + '_from_month', prefix + '_from_year',
          prefix + '_to_day', prefix + '_to_month', prefix + '_to_year'
        ])
      }]
    })
  }
  tagDateRange('Open date', 'open', openFrom, openTo)
  tagDateRange('Close date', 'close', closeFrom, closeTo)

  var hasActiveFilters = selectedCategories.length > 0

  res.render('results', {
    results: pageResults,
    query: q || exactId,
    totalResults: totalResults,
    currentPage: currentPage,
    totalPages: totalPages,
    paginationItems: paginationItems,
    prevHref: currentPage > 1 ? buildPageUrl(req, currentPage - 1) : null,
    nextHref: currentPage < totalPages ? buildPageUrl(req, currentPage + 1) : null,
    typeOptions: typeOptions,
    statusOptions: statusOptions,
    laOptions: laOptions,
    senOptions: senOptions,
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
    selectedCategories: selectedCategories,
    hasActiveFilters: hasActiveFilters,
    clearFiltersHref: buildClearFiltersUrl(req),
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

  // Find any predecessor establishments
  var predecessors = predecessorsData[id] || []

  // Governance record (governors for providers; trustees + members for groups)
  var governance = governanceData[id] || null

  res.render('establishment', {
    item: item,
    members: members,
    predecessors: predecessors,
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
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
  }).join('&')
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

function buildClearFiltersUrl (req) {
  var params = {}
  if (req.query.what) params.what = req.query.what
  if (req.query.where) params.where = req.query.where
  if (req.query.id) params.id = req.query.id
  var qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
  }).join('&')
  return '/results?' + qs
}


