//
// For guidance on how to create filters see:
// https://prototype-kit.service.gov.uk/docs/filters
//

const govukPrototypeKit = require('govuk-prototype-kit')
const addFilter = govukPrototypeKit.views.addFilter

// Add your filters here

// Updates the date with the current date
const moment = require('moment')

addFilter('govukDate', function (date) {
  if (date === 'now' || !date) {
    return moment().format('D MMM YYYY')
  }
  // GIAS dates are day-first: 'DD-MM-YYYY' or 'DD/MM/YYYY'. Also accept ISO
  // ('YYYY-MM-DD') for any other sources. strict parsing avoids misreads.
  const d = moment(date, ['DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', moment.ISO_8601], true)
  return d.isValid() ? d.format('D MMM YYYY') : date
})

// GOV.UK style guide: numerals over 999 take a comma (9,000). Works on numbers
// and on text containing numbers, e.g. "1040 (0 girls, 1040 boys)". Run-ups of
// digits inside decimals (22.70%) and identifiers are left alone because the
// filter is only applied where a count is shown.
addFilter('thousands', function (value) {
  if (value === null || value === undefined || value === '') return value
  // Some source counts are stored as floats ("30.0"); show them as whole numbers.
  if (/^\d+\.0+$/.test(String(value))) value = String(value).replace(/\.0+$/, '')
  return String(value).replace(/(^|[^\d.,])(\d{4,})(?![\d.]*\d)/g, function (m, pre, digits) {
    return pre + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  })
})
