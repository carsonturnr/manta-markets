// URLs that match no route render here, outside the (site) group: wrap the site's page in its frame.
import SiteLayout from "./(site)/layout";
import NotFound from "./(site)/not-found";

export default function RootNotFound() {
  return (
    <SiteLayout params={Promise.resolve({})}>
      <NotFound />
    </SiteLayout>
  );
}
