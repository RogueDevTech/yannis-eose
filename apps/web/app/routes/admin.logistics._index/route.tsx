import { redirect } from '@remix-run/node';

export async function loader() {
  return redirect('/admin/logistics/partners');
}

export default function LogisticsIndexRedirect() {
  return null;
}
