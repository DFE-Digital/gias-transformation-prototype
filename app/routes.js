//
// For guidance on how to create routes see:
// https://prototype-kit.service.gov.uk/docs/create-routes
//

const govukPrototypeKit = require('govuk-prototype-kit')
const router = govukPrototypeKit.requests.setupRouter()
const giasData = require('./data/gias_prototype.json')
const predecessorsData = require('./data/predecessors.json')

const RESULTS_PER_PAGE = 20

// Build a set of closed establishment IDs that have been matched as predecessors
const matchedPredecessorIds = new Set()
Object.values(predecessorsData).forEach(function (preds) {
  preds.forEach(function (p) {
    matchedPredecessorIds.add(p.id)
  })
})

// Active data — excludes closed establishments and matched predecessors
const activeData = giasData.filter(function (item) {
  if (item.status === 'Closed') return false
  return true
})

// Archive data — closed URN establishments with no matched predecessor
const archiveData = giasData.filter(function (item) {
  return item.status === 'Closed' &&
    !matchedPredecessorIds.has(item.id)
})

// Index page
router.get('/index', function (req, res) {
  res.render('index')
})

// Autocomplete API endpoint
router.get('/api/schools', function (req, res) {
  var q = (req.query.q || '').toLowerCase()

  if (q.length < 2) {
    return res.json([])
  }

  var results = activeData.filter(function (item) {
    return (
      (item.name && item.name.toLowerCase().indexOf(q) !== -1) ||
      (item.id && item.id.toLowerCase().indexOf(q) !== -1) ||
      (item.local_authority && item.local_authority.toLowerCase().indexOf(q) !== -1) ||
      (item.part_of && item.part_of.group_name && item.part_of.group_name.toLowerCase().indexOf(q) !== -1) ||
      (item.part_of && item.part_of.group_uid && item.part_of.group_uid.toLowerCase().indexOf(q) !== -1)
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
  var q = (req.query.q || '').trim()
  var exactId = (req.query.id || '').trim()
  var currentPage = parseInt(req.query.page) || 1

  // Active filters
  var activeTypes = [].concat(req.query.type || []).filter(function (v) { return v !== '_unchecked' })
  var activeStatuses = [].concat(req.query.status || []).filter(function (v) { return v !== '_unchecked' })
  var activeLAs = [].concat(req.query.local_authority || []).filter(function (v) { return v !== '_unchecked' })
  var activeSen = [].concat(req.query.sen_provision || []).filter(function (v) { return v !== '_unchecked' })

  // Base search against active data only
  var searchResults = []

  if (exactId) {
  searchResults = activeData.filter(function (item) {
    return item.id === exactId
  })
} else if (q === '*' || q.length === 0) {
  searchResults = activeData
} else if (q.length > 0) {
    var qLower = q.toLowerCase()
    searchResults = activeData.filter(function (item) {
      return (
        (item.name && item.name.toLowerCase().indexOf(qLower) !== -1) ||
        (item.id && item.id.toLowerCase().indexOf(qLower) !== -1) ||
        (item.local_authority && item.local_authority.toLowerCase().indexOf(qLower) !== -1) ||
        (item.part_of && item.part_of.group_name && item.part_of.group_name.toLowerCase().indexOf(qLower) !== -1) ||
        (item.part_of && item.part_of.group_uid && item.part_of.group_uid.toLowerCase().indexOf(q) !== -1)
      )
    })
  }

  // Calculate counts from full search results (before filtering)
  var typeCounts = {}
  var statusCounts = {}
  var laCounts = {}
  var senCounts = { 'true': 0, 'false': 0 }

  searchResults.forEach(function (item) {
    if (item.type) typeCounts[item.type] = (typeCounts[item.type] || 0) + 1
    if (item.status) statusCounts[item.status] = (statusCounts[item.status] || 0) + 1
    if (item.local_authority) laCounts[item.local_authority] = (laCounts[item.local_authority] || 0) + 1
    var senKey = item.sen_provision ? 'true' : 'false'
    senCounts[senKey]++
  })

  // Apply filters
  var filteredResults = searchResults.filter(function (item) {
    if (activeTypes.length > 0 && activeTypes.indexOf(item.type) === -1) return false
    if (activeStatuses.length > 0 && activeStatuses.indexOf(item.status) === -1) return false
    if (activeLAs.length > 0 && activeLAs.indexOf(item.local_authority) === -1) return false
    if (activeSen.length > 0 && activeSen.indexOf(String(item.sen_provision)) === -1) return false
    return true
  })

  // Sort alphabetically
  filteredResults.sort(function (a, b) {
    var nameA = a.name.replace(/^[^a-zA-Z0-9]+/, '')
    var nameB = b.name.replace(/^[^a-zA-Z0-9]+/, '')
    return nameA.localeCompare(nameB)
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
        return school.part_of && school.part_of.group_uid === item.id
      }).length
      return Object.assign({}, item, { memberCount: memberCount })
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

  // Build selected filter tags
  var selectedCategories = []

  if (activeTypes.length > 0) {
    selectedCategories.push({
      heading: { text: 'Type' },
      items: activeTypes.map(function (val) {
        return { text: val, href: buildRemoveFilterUrl(req, 'type', val) }
      })
    })
  }

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

  if (activeSen.length > 0) {
    selectedCategories.push({
      heading: { text: 'SEN provision' },
      items: activeSen.map(function (val) {
        return { text: val === 'true' ? 'Yes' : 'No', href: buildRemoveFilterUrl(req, 'sen_provision', val) }
      })
    })
  }

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
    selectedCategories: selectedCategories,
    hasActiveFilters: hasActiveFilters,
    clearFiltersHref: buildClearFiltersUrl(req),
    searchQ: q,
    searchId: exactId,
    currentUrl: req.originalUrl
  })
})

// Archive search page
router.get('/archive', function (req, res) {
  var q = (req.query.q || '').trim()
  var currentPage = parseInt(req.query.page) || 1

  var activeTypes = [].concat(req.query.type || []).filter(function (v) { return v !== '_unchecked' })
  var activeStatuses = [].concat(req.query.status || []).filter(function (v) { return v !== '_unchecked' })
  var activeLAs = [].concat(req.query.local_authority || []).filter(function (v) { return v !== '_unchecked' })

  var searchResults = []

  if (q.length > 0 && q !== '*') {
   var qLower = q.toLowerCase()
    searchResults = archiveData.filter(function (item) {
      return (
        (item.name && item.name.toLowerCase().indexOf(qLower) !== -1) ||
        (item.id && item.id.toLowerCase().indexOf(qLower) !== -1) ||
        (item.local_authority && item.local_authority.toLowerCase().indexOf(qLower) !== -1)
      )
    })
  } else {
    searchResults = archiveData
  }

  // Calculate counts
  var typeCounts = {}
  var statusCounts = {}
  var laCounts = {}

  searchResults.forEach(function (item) {
    if (item.type) typeCounts[item.type] = (typeCounts[item.type] || 0) + 1
    if (item.status) statusCounts[item.status] = (statusCounts[item.status] || 0) + 1
    if (item.local_authority) laCounts[item.local_authority] = (laCounts[item.local_authority] || 0) + 1
  })

  // Apply filters
  var filteredResults = searchResults.filter(function (item) {
    if (activeTypes.length > 0 && activeTypes.indexOf(item.type) === -1) return false
    if (activeStatuses.length > 0 && activeStatuses.indexOf(item.status) === -1) return false
    if (activeLAs.length > 0 && activeLAs.indexOf(item.local_authority) === -1) return false
    return true
  })

  filteredResults.sort(function (a, b) {
    var nameA = a.name.replace(/^[^a-zA-Z0-9]+/, '')
    var nameB = b.name.replace(/^[^a-zA-Z0-9]+/, '')
    return nameA.localeCompare(nameB)
  })

  var totalResults = filteredResults.length
  var totalPages = Math.ceil(totalResults / RESULTS_PER_PAGE) || 1

  if (currentPage < 1) currentPage = 1
  if (currentPage > totalPages) currentPage = totalPages

  var startIndex = (currentPage - 1) * RESULTS_PER_PAGE
  var pageResults = filteredResults.slice(startIndex, startIndex + RESULTS_PER_PAGE)

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
          href: buildArchivePageUrl(req, i)
        })
      } else if (
        paginationItems.length > 0 &&
        !paginationItems[paginationItems.length - 1].ellipsis
      ) {
        paginationItems.push({ ellipsis: true })
      }
    }
  }

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

  var selectedCategories = []

  if (activeTypes.length > 0) {
    selectedCategories.push({
      heading: { text: 'Type' },
      items: activeTypes.map(function (val) {
        return { text: val, href: buildRemoveArchiveFilterUrl(req, 'type', val) }
      })
    })
  }

  if (activeStatuses.length > 0) {
    selectedCategories.push({
      heading: { text: 'Status' },
      items: activeStatuses.map(function (val) {
        return { text: val, href: buildRemoveArchiveFilterUrl(req, 'status', val) }
      })
    })
  }

  if (activeLAs.length > 0) {
    selectedCategories.push({
      heading: { text: 'Local authority' },
      items: activeLAs.map(function (val) {
        return { text: val, href: buildRemoveArchiveFilterUrl(req, 'local_authority', val) }
      })
    })
  }

  var hasActiveFilters = selectedCategories.length > 0

  res.render('archive', {
    results: pageResults,
    query: q,
    totalResults: totalResults,
    currentPage: currentPage,
    totalPages: totalPages,
    paginationItems: paginationItems,
    prevHref: currentPage > 1 ? buildArchivePageUrl(req, currentPage - 1) : null,
    nextHref: currentPage < totalPages ? buildArchivePageUrl(req, currentPage + 1) : null,
    typeOptions: typeOptions,
    statusOptions: statusOptions,
    laOptions: laOptions,
    selectedCategories: selectedCategories,
    hasActiveFilters: hasActiveFilters,
    clearFiltersHref: buildClearArchiveFiltersUrl(req),
    searchQ: q,
    currentUrl: req.originalUrl,
    totalArchive: archiveData.length
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
      return school.part_of && school.part_of.group_uid === id
    })
  }

  // Find any predecessor establishments
  var predecessors = predecessorsData[id] || []

  res.render('establishment', {
    item: item,
    members: members,
    predecessors: predecessors,
    backLink: req.query.from || '/results'
  })
})

// View all establishments
router.get('/all', function (req, res) {
  res.redirect('/results?q=*')
})

// Archive API endpoint for autocomplete
router.get('/api/archive', function (req, res) {
  var q = (req.query.q || '').toLowerCase()

  if (q.length < 2) {
    return res.json([])
  }

  var results = archiveData.filter(function (item) {
    return (
      (item.name && item.name.toLowerCase().indexOf(q) !== -1) ||
      (item.id && item.id.toLowerCase().indexOf(q) !== -1) ||
      (item.local_authority && item.local_authority.toLowerCase().indexOf(q) !== -1)
    )
  })

  res.json(results.slice(0, 20).map(function (item) {
    var identifier = item.id_type + ': ' + item.id
    var la = item.local_authority ? ' — ' + item.local_authority : ''
    return item.name + ' (' + identifier + ')' + la
  }))
})

function buildPageUrl (req, page) {
  var params = Object.assign({}, req.query, { page: page })
  var qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
  }).join('&')
  return '/results?' + qs
}

function buildArchivePageUrl (req, page) {
  var params = Object.assign({}, req.query, { page: page })
  var qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
  }).join('&')
  return '/archive?' + qs
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

function buildRemoveArchiveFilterUrl (req, filterKey, filterValue) {
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
  return '/archive?' + qs
}

function buildClearFiltersUrl (req) {
  var params = {}
  if (req.query.q) params.q = req.query.q
  if (req.query.id) params.id = req.query.id
  var qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
  }).join('&')
  return '/results?' + qs
}

function buildClearArchiveFiltersUrl (req) {
  var params = {}
  if (req.query.q) params.q = req.query.q
  var qs = Object.keys(params).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
  }).join('&')
  return '/archive?' + qs
}