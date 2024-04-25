/// <reference types="Cypress" />

describe('template spec', () => {
  it('passes', () => {
    cy.visit('/login')
    cy.get('[name="email"]').should("exist").type('abhishekism0010@gmail.com')
    cy.get('[name="password"]').should("exist").type('avisekkr')
    cy.get('button').click()
  })
})