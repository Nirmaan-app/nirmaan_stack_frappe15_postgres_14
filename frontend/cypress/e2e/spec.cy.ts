/// <reference types="Cypress" />

describe('admin CAN handle projects', () => {
  beforeEach(()=> {
    cy.visit('/login')
    cy.get('[name="email"]').should("exist").type('Administrator')
    cy.get('[name="password"]').should("exist").type('admin')
    cy.get('button').click()
  })
  it('CAN open project list', () => {
    cy.getByData("admin-dashboard-project-card").click()
   
  })
  it('CAN create correct project', () => {
    cy.getByData("admin-dashboard-project-card").click()
    cy.getByData("add-project-button").click()
  })

  it('CANNOT create incorrect project', () => {
    cy.getByData("")
  })

})

// describe('item create', () => {
//   it
// })