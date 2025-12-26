import unittest

from search_text import generate_search_name, normalize_base


class SearchTextTests(unittest.TestCase):
    def test_packaging_kg(self):
        self.assertEqual(generate_search_name("Сыр Моцарелла 1кг"), "сыр моцарелла")

    def test_packaging_multiplier(self):
        self.assertEqual(generate_search_name("10x1л Сок яблочный"), "сок яблочный")

    def test_percent_kept(self):
        self.assertEqual(generate_search_name("Сливки 33% 900 мл"), "сливки 33%")

    def test_punctuation_cleanup(self):
        self.assertEqual(generate_search_name("Филе кур. охл. 1кг"), "филе кур охл")
        self.assertEqual(generate_search_name("говядина, вырезка 2кг"), "говядина вырезка")

    def test_single_word(self):
        self.assertEqual(generate_search_name("Соль"), "соль")

    def test_yo_to_e(self):
        self.assertEqual(normalize_base("ёжик"), "ежик")


if __name__ == "__main__":
    unittest.main()
