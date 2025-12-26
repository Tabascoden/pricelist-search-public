import os
import unittest

from app import create_app


RUN_SMOKE = os.getenv("RUN_API_SMOKE") == "1"
PROJECT_ID = os.getenv("TENDER_PROJECT_ID")
SUPPLIER_ID = os.getenv("SUPPLIER_ID")
ITEM_ID = os.getenv("TENDER_ITEM_ID")


@unittest.skipUnless(RUN_SMOKE, "Set RUN_API_SMOKE=1 to run API smoke tests")
class ApiSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.client = cls.app.test_client()

    def test_search_endpoint(self):
        resp = self.client.get("/search", query_string={"q": "молоко", "limit": 1})
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        self.assertIn("items", payload)

    @unittest.skipUnless(PROJECT_ID and SUPPLIER_ID, "Set TENDER_PROJECT_ID and SUPPLIER_ID for tender smoke tests")
    def test_tender_matrix(self):
        resp = self.client.get(
            f"/api/tenders/{PROJECT_ID}/matrix",
            query_string={"supplier_ids": SUPPLIER_ID, "limit": 1},
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        self.assertIn("matrix", payload)

    @unittest.skipUnless(ITEM_ID and SUPPLIER_ID, "Set TENDER_ITEM_ID and SUPPLIER_ID for tender smoke tests")
    def test_tender_matches(self):
        resp = self.client.get(
            f"/api/tenders/items/{ITEM_ID}/matches",
            query_string={"supplier_id": SUPPLIER_ID, "limit": 1},
        )
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        self.assertIn("matches", payload)


if __name__ == "__main__":
    unittest.main()
