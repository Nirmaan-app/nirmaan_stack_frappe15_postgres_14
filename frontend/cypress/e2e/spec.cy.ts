/// <reference types="Cypress" />

describe('admin login', () => {
  it('successfully loads', () => {
    cy.visit('/login')
  })
  it('passes', () => {
    cy.visit('/login')
    cy.get('[name="email"]').should("exist").type('Administrator')
    cy.get('[name="password"]').should("exist").type('admin')
    cy.get('button').click()
  })
})

// describe('item create', () => {
//   it
// })