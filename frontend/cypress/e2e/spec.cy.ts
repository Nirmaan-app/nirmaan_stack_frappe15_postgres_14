/// <reference types="Cypress" />

describe('admin login', () => {
  beforeEach(()=> {
    cy.visit('/login')
    cy.get('[name="email"]').should("exist").type('Administrator')
    cy.get('[name="password"]').should("exist").type('admin')
    cy.get('button').click()
  })
  it('opens projects', () => {
    cy.get('[data-cy="admin-dashboard-project-card"]').click()
   
  })
})

// describe('item create', () => {
//   it
// })