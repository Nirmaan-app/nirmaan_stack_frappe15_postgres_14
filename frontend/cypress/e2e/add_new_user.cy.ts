/// <reference types="Cypress" />

const emailNU = Cypress.env('login_Email');
const padsswordNU = Cypress.env('login_Password');

describe('Adding a New User', () => {

    beforeEach(() => {
        // Logging In --->
        cy.intercept('POST', '**/api/method/login').as('loginRequest');

        cy.visit('/login')

        cy.contains('Login', {timeout: 3000}).should('be.visible');
        cy.get('[data-cy="username-login-input-email"]').should('be.visible').type(emailNU);
        cy.get('[data-cy="username-login-input-password"]').should('be.visible').type(padsswordNU);
        cy.get('[data-cy="login-button"]').should('be.visible').click();    

        cy.wait('@loginRequest', {timeout: 3000}).its('response.statusCode').should('eq', 200);
        cy.url().should('include', 'localhost:8080');
        cy.contains('Modules').should('be.visible');

    });

    it('Creating a New User', () => {

        cy.intercept('POST', '/api/users').as('createUser');

        cy.get('[data-cy="admin-dashboard-users-card"]')
        .should('exist')
        .and('be.visible')
        .and('have.class', 'shadow')
        .and('have.class', 'border')
        .then(($card) => {
            expect($card).to.have.class('hover:animate-shadow-drop-center');
            cy.wrap($card).find('a[href="/users"]')
            .should('exist').should('have.attr', 'href', '/users');

        });

        cy.get('[data-cy="admin-dashboard-users-card"]')
        .find('div.p-5.pt-0')
        .within(() => {
            cy.get('.text-2xl')
                .should('be.visible')
                .and(($el) => {
                    const textContent = $el.text();
                    expect(textContent.trim(), 'Element text should not be empty')
                    .not.to.be.empty;
                })
                .invoke('text')
                .then((text) => {
                    cy.log(`Original text from element: "${text}"`);
                    const numericText = text.trim().replace(/[^0-9]/g, '');
                    cy.log(`Processed numericText: "${numericText}"`);
                    expect(numericText, 'Extracted numeric string should not be empty')
                    .not.to.be.empty;

                    expect(numericText, 'Users count should be numeric (consist of digits only)')
                    .to.match(/^\d+$/);

                    const count = parseInt(numericText, 10);
                    expect(count, 'Parsed count should be a number')
                    .not.to.be.NaN;
                    expect(count, 'Users count should be a positive number')
                    .to.be.a('number')
                    .and.be.gt(0);
                });

            });

            cy.get('[data-cy="admin-dashboard-users-card"] a')
                .should('have.attr', 'href', '/users')
                .then(($link) => {
                    const href = $link.attr('href');
                    cy.wrap($link).click();
                    cy.url().should('include', '/users');
                });

            cy.get('button', {timeout: 2000})
            .contains(/Add( New User)?/i)
            .should('be.visible')
            .and('not.be.disabled')
            .and('have.class', 'bg-primary');

            cy.contains('button', /Add(New User)?/i)
            .click()
            .then(() => {
                cy.url().should('include', 'users/new-user');
            });

            // 1. Verifying form structure
            cy.contains('p', 'Fill all the marked details to create a new User')
            .should('be.visible');
            cy.contains('p', 'User Details').should('be.visible');

            // 2. Test required field validation
            cy.get('button[type="submit"]').click();
            cy.contains('Must Provide First name').should('be.visible');
            cy.contains('Must Provide Last name').should('be.visible');
            cy.contains('Must provide Unique Mobile Number').should('be.visible');
            cy.contains('Must Provide Email').should('be.visible');
            cy.contains('Please select associated Role Profile.').should('be.visible');

            // 3. Filling form with test data
            const testUser = {
                firstName: 'Test',
                lastName: 'User',
                mobile: `9${Cypress._.random(100000000, 999999999)}`,
                email: `test.user+${Date.now()}@example.com`,
                role: 'Project Manager',
                dateJoined: new Date().toLocaleDateString('en-GB'),
            };

            // Fill basic fields
            cy.get('input[name="first_name"]')
                .type(testUser.firstName)
                .should('be.visible')
                .should('have.value', testUser.firstName);

            cy.get('input[name="last_name"]')
                .type(testUser.lastName)
                .should('be.visible')
                .should('have.value', testUser.lastName);

            cy.get('input[name="mobile_no"]')
                .type('123')
                .blur();
            cy.contains('Mobile number must be of 10 digits')
                .should('be.visible');
            
            cy.get('input[name="mobile_no"]')
                .clear()
                .type(testUser.mobile)
                .should('be.visible')
                .should('have.value', testUser.mobile);


            cy.get('input[name="email"]')
                .type('nvalid-email')
                .blur();
            cy.contains('Invalid email address')
                .should('be.visible');
            cy.get('input[name="email"]')
                .clear()
                .type(testUser.email)
                .should('be.visible')
                .should('have.value', testUser.email);
            
            cy.get('button[role="combobox"]').click();
            cy.contains('div', testUser.role).click();
            cy.get('button[role="combobox"]')
            .should('contain', testUser.role);

            // Submit Form
            cy.get('button[type="submit"]').click();
      

            // // API Validation
            // cy.wait('@createUser', {timeout: 3000}).then((interception) => {
            //     expect(interception.request.body).to.include({
            //         first_name: testUser.firstName,
            //         last_name: testUser.lastName,
            //         mobile_no: testUser.mobile,
            //         email: testUser.email,
            //         role: testUser.role
            //     });
            //     expect(interception.response?.statusCode).to.equal(200);
            // });



            // Success Validation
            // cy.contains('User created Successfully').should('be.visible');
            cy.url().should('include', '/users');

            // Verifying new user appears in list
            cy.get('.p-1').click();
            cy.get('table[data-cy="procurement-requests-data-table"]').should('exist');
            cy.contains('tr', testUser.email)
                .should('exist')
                .within(() => {
                    // Verify all user data in the row
                    cy.contains('td', testUser.firstName).should('exist');
                    cy.contains('td', testUser.lastName).should('exist');
                    cy.contains('td', testUser.email)
                        .should('exist')
                        .find('a')
                        .should('have.attr', 'href')
                        .and('include', `/users/${testUser.email}`);
                    
                    cy.contains('td', testUser.role).should('exist');
                    cy.contains('td', testUser.dateJoined).should('exist');

                    // Verifying contact information
                    cy.contains('td', `${testUser.mobile}`).should('exist');
                    cy.contains('td', `${testUser.email}`).should('exist');
                });
                
    });

    it('Should prevent duplicate email submission', () => {

        // Navigating to create user form
        cy.get('[data-cy="admin-dashboard-users-card"]').click();
        cy.contains('button', /Add( New User)?/i).click();

        // Using existing email
        const existingUser = {
            firstName: 'Duplicate',
            lastName: 'Test',
            mobile: '9876543211',
            email: 'existing.user@example.com', // This email already exists
            role: 'Project Lead'
        };

        // Filling form
        cy.get('input[name="first_name"]').type(existingUser.firstName);
        cy.get('input[name="last_name"]').type(existingUser.lastName);
        cy.get('input[name="mobile_no"]').type(existingUser.mobile);
        cy.get('input[name="email"]').type(existingUser.email);
        cy.get('button[role="combobox"]').click();
        cy.contains('div', existingUser.role).click();

        // Submit and verify error
        // cy.intercept('POST', '**/api/method/create_user').as('createUser');
        cy.get('button[type="submit"]').click();
        // cy.wait('@createUser');
        cy.contains('Error').should('be.visible');
        
    });
});