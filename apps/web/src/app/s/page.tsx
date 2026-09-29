import { redirect } from 'next/navigation';

/**
 * The short address printed on the welcome sheet (« …/s »). A code in the fragment
 * (…/s#code=…) survives the redirect: browsers keep it when the new address has none.
 */
export default function ShortPortalLink() {
  redirect('/suppleance');
}
