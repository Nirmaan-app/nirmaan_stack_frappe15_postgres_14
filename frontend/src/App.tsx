// import { useState } from 'react'
import { FrappeConfig, FrappeContext, FrappeProvider, useFrappePutCall } from 'frappe-react-sdk'
// import { Button } from './components/ui/button'
import {  Route, RouterProvider, createBrowserRouter, createRoutesFromElements, useFetcher } from 'react-router-dom'
import Dashboard from './pages/dashboard'
import Login from './pages/auth/old-login'
import Projects from './pages/projects/projects'
import Customers from './pages/customers/customers'
import WorkPackages from './pages/work-packages'
import Profile from './pages/users/user-profile'
import { EditProjectForm } from './pages/projects/edit-project-form'
import { ApprovePR } from './pages/approve-pr'
import { PRList } from './components/procurement/procurement-approved'
import { ProcurementOrder } from './components/procurement/procurement-vendor'
import { SelectVendors } from './components/procurement/select-vendors'
import { UpdateQuote } from './components/procurement/update-quote'
import { SentBackRequest } from './components/procurement/sent-back-request'
import { SentBackUpdateQuote } from './components/procurement/sent-back-update-quote'
import { SentBackSelectVendor } from './components/procurement/sent-back-select-vendor'
import { ReleasePOSelect } from './components/procurement/release-po-select'
import { QuoteUpdateSelect } from './components/procurement/quote-update-select'
import { SelectVendorList } from './components/procurement/select-vendor-list'
import { ApproveSelectSentBack } from './pages/approve-select-sent-back'
import { PDF } from './pages/pdf'
//import { useStickyState } from './hooks/useStickyState'
import { ThemeProvider } from './components/ui/theme-provider'
import {  LeadRoute, ProtectedRoute } from './utils/auth/ProtectedRoute'
import { UserProvider } from './utils/auth/UserProvider'

//import AuthenticationPage from './pages/auth/login-shadcn'
import Users from './pages/users/users'
import Roles from './pages/roles'
import Debug from './pages/debug'
import { ApproveSelectVendor } from './pages/approve-select-vendor'
// import { ApproveVendor } from './pages/approve-vendor'
// import { PRSummary } from './components/pr-summary'
import { UserForm } from './pages/users/user-form'
import Items from './pages/Items/items'

import Vendors from './pages/vendors/vendors'

import ListPR from './components/procurement-request/list-pr'
import { EditVendor } from './pages/vendors/edit-vendor'
import { FC, useContext, useEffect } from 'react'
import { MainLayout } from './components/layout/main-layout'
import { ProjectManager } from './components/dashboard-pm'

// import { Project } from './pages/project'
import { DelayedPRSelect } from './pages/delayed-pr-select'
import { DelayedPR } from './pages/delayed-pr'
import NewCustomer from './pages/customers/add-new-customer'
import EditCustomer from './pages/customers/edit-customer'
import { NewVendor } from './pages/vendors/new-vendor'
import NewMilestones from './components/updates/NewMilestones'
import DeliveryNotes from './pages/DeliveryNotes/deliverynotes'
import DeliveryNote from './pages/DeliveryNotes/deliverynote'
import { ProjectForm } from './pages/projects/project-form'
import { ReleasePONew } from './components/updates/ReleasePONew'
import { ApprovedQuotationsTable } from './pages/ApprovedQuotationsFlow/ApprovedQuotationsTable'
import EditUserForm from './pages/users/EditUserForm'
import { messaging, VAPIDKEY } from './firebase/firebaseConfig'
import { onMessage } from 'firebase/messaging'
// import { NewMilestone } from './components/new-milestone'


const router = createBrowserRouter(
	createRoutesFromElements(
		<>
			{/* <Route path='/login' lazy={() => import('@/pages/auth/Login')} /> */}
			{/* <Route path='/login' element={<Component />} /> */}
			<Route path='/login' element={<Login />} />

			<Route path='/forgot-password' lazy={() => import('@/pages/auth/forgot-password')} />
			<Route path='/' element={<ProtectedRoute />}>

				<Route path='/' element={<MainLayout />}>

					<Route index element={<Dashboard />} />


					<Route path="pdf" element={<PDF />} />
					{/* <Route path="/new-pr/:id" element={<NewPR />} /> */}
					{/* <Route path="/pr-summary/:id" element={<PRSummary />} /> */}
					{/* <Route path="/milestone/:id" element={<NewMilestone/>} /> */}

					{/* <Route path='/prs&milestones' element={<LeadRoute />}> */}
						<Route path='/prs&milestones' element={<ProjectManager />} />
					{/* </Route> */}

					<Route path='/milestone-update' element={<NewMilestones />} />

					<Route path="approve-order" element={<ApprovePR />} />
					<Route path="/approve-order/:id" lazy={() => import('@/pages/approve-order')} />
					<Route path="approve-vendor" element={<ApproveSelectVendor />} />
					<Route path="approve-vendor/:orderId" lazy={() => import('@/pages/approve-vendor')} />
					<Route path="approve-sent-back" element={<ApproveSelectSentBack />} />
					<Route path="approve-sent-back/:id" lazy={() => import('@/pages/approve-sent-back')} />
					<Route path="delayed-pr" element={<DelayedPRSelect />} />
					<Route path="delayed-pr/:id" element={<DelayedPR />} />

					<Route path="procure-request" element={<PRList />} />
					<Route path="update-quote" element={<QuoteUpdateSelect />} />
					<Route path="select-vendor-list" element={<SelectVendorList />} />
					<Route path="sent-back-request" element={<SentBackRequest />} />
					<Route path="sent-back-request/:id" element={<SentBackUpdateQuote />} />
					<Route path="sent-back-request/select-vendor/:id" element={<SentBackSelectVendor />} />
					<Route path="/procure-request/:orderId" element={<ProcurementOrder />} />
					<Route path="/procure-request/quote-update/:orderId" element={<UpdateQuote />} />
					<Route path="/procure-request/quote-update/select-vendors/:orderId" element={<SelectVendors />} />
					<Route path="release-po" element={<ReleasePOSelect not={false} status="PO Approved" />} />
					{/* <Route path="/release-po/:id" element={<ReleasePO />} /> */}
					<Route path="/release-po/:id" element={<ReleasePONew />} />

					<Route path="released-po" element={<ReleasePOSelect not={true} status="PO Approved" />} />
					{/* <Route path="/release-po/:id" element={<ReleasePO />} /> */}
					<Route path="/released-po/:id" element={<ReleasePONew />} />

					<Route path="delivery-notes" element={<DeliveryNotes />} />
					<Route path="/delivery-notes/:id" element={<DeliveryNote />} />

					<Route path="projects">
						<Route index element={<Projects />} />
						<Route path="new" element={<ProjectForm />} />
						<Route
							path=":projectId"
							// loader={(({ params }) => {
							// 	console.log(params.projectId)
							// })}
							// action={(({ params }) => {})}
							lazy={() => import('@/pages/projects/project')}
						/>
						<Route path=":projectId/edit" element={<EditProjectForm />} />
					</Route>

					<Route path="users">
						<Route index element={<Users />} />
						<Route path="new" element={<UserForm />} />
						<Route path=":id" element={<Profile />} />
						<Route path=':id/edit' element={<EditUserForm />} />
					</Route>

					<Route path="wp" element={<WorkPackages />} />

					<Route path="items" >
						<Route index element={<Items />} />
						<Route path=":itemId" lazy={() => import('@/pages/Items/item')} />
					</Route>

					<Route path="vendors">
						<Route index element={<Vendors />} />
						<Route path="new" element={<NewVendor />} />
						<Route path=":vendorId" lazy={() => import('@/pages/vendors/vendor')} />
						<Route path=":id/edit" element={<EditVendor />} />
					</Route>

					<Route path="roles">
						<Route index element={<Roles />} />
					</Route>
					<Route path="customers" >
						<Route index element={<Customers />} />
						<Route path="new" element={<NewCustomer />} />
						<Route path=":customerId" lazy={() => import('@/pages/customers/customer')} />
						<Route path=":id/edit" element={<EditCustomer />} />
					</Route>

					{/* Procurement Request Paths */}
					<Route path="procurement-request">
						<Route index element={<ListPR />} />
						<Route path=":id/new" lazy={() => import('@/components/procurement-request/new-pr')} />
						<Route path=":id" lazy={() => import('@/components/pr-summary')} />
					</Route>

					<Route path="debug">
						{/* <Route index element={<Debug />} /> */}
						<Route index element={<ApprovedQuotationsTable />} />
					</Route>
				</Route>

				{/* <Route path="testlogin" element={<AuthenticationPage />} /> */}
			</Route >
		</>
	), {
	basename: `/${import.meta.env.VITE_BASE_NAME}` ?? "",
}
)


// if ('serviceWorker' in navigator) {
// 	navigator.serviceWorker
// 	  .register('./public/firebase-messaging-sw.js')
// 	  .then((registration) => {
// 		console.log('Service Worker registered with scope:', registration.scope);
// 	  })
// 	  .catch((err) => {
// 		console.log('Service Worker registration failed:', err);
// 	  });
//   }
  

const App: FC = () => {

	useEffect(() => {
		if ('serviceWorker' in navigator) {
		  navigator.serviceWorker
			.register('/firebase-messaging-sw.js') // Corrected path
			.then((registration) => {
			  console.log('Service Worker registered with scope:', registration.scope);
			})
			.catch((err) => {
			  console.log('Service Worker registration failed:', err);
			});
		}
	
		// Firebase onMessage handler for foreground notifications
		onMessage(messaging, (payload) => {
		  console.log('Message received in the foreground: ', payload);
		  new Notification(payload.notification?.title || '', {
			body: payload.notification?.body || '',
		  });
		});
	  }, []);

	const getSiteName = () => {
		// @ts-ignore
		if (window.frappe?.boot?.versions?.frappe && (window.frappe.boot.versions.frappe.startsWith('15') || window.frappe.boot.versions.frappe.startsWith('16'))) {
			// @ts-ignore
			return window.frappe?.boot?.sitename ?? import.meta.env.VITE_SITE_NAME
		}
		return import.meta.env.VITE_SITE_NAME
	}

	// const queryClient = new QueryClient()

	return (
		<FrappeProvider
			url={import.meta.env.VITE_FRAPPE_PATH ?? ""}
			socketPort={import.meta.env.VITE_SOCKET_PORT ? import.meta.env.VITE_SOCKET_PORT : undefined}
			//@ts-ignore
			siteName={getSiteName()}>
			<UserProvider>
				{/* <QueryClientProvider client={queryClient}> */}
				<ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
					<RouterProvider router={router} />
				</ThemeProvider>
				{/* </QueryClientProvider> */}
			</UserProvider>
		</FrappeProvider>
	)
}

export default App